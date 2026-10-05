import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('dispatch has no inputs, runs on main in protected production and calls only exact SHA health', async () => {
  const [workflow, deploy, grant, installer, upgrade] = await Promise.all([
    '.github/workflows/db-due-health.yml', '.github/workflows/deploy.yml',
    'scripts/deploy/bootstrap-deploy-user.sh', 'scripts/deploy/install-release.sh',
    'scripts/deploy/upgrade-deployment-assets',
  ].map((file) => readFile(file, 'utf8')));
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /inputs:|ingest|drain|schedule:|sudoers|\$\{\{\s*inputs\./);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: festival-radar-production/);
  assert.match(deploy, /group: festival-radar-production/);
  for (const key of ['DEPLOY_HOST', 'DEPLOY_PORT', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_SSH_KEY']) {
    assert.ok(workflow.includes('secrets.' + key));
  }
  assert.match(workflow, /User festival-radar-deploy/);
  assert.match(workflow, /StrictHostKeyChecking yes/);
  assert.match(workflow, /ssh production sudo -n \/usr\/local\/libexec\/festival-radar\/activate-release "\$GITHUB_SHA" due-health/);
  assert.match(grant, /NOPASSWD: \/usr\/local\/libexec\/festival-radar\/activate-release \[0-9a-f\]\*/);
  assert.doesNotMatch(grant, /NOPASSWD:.*start-db-due/);
  assert.match(upgrade, /for asset in activate-release install-release\.sh upgrade-deployment-assets/);
  assert.match(installer, /install -o root -g root -m 0755 "\$release\/scripts\/deploy\/start-db-due" "\$db_due_wrapper"/);
  assert.match(installer, /StandardOutput=append:\/run\/festival-radar-db-due\/%i\.audit/);
  assert.doesNotMatch(installer, /systemctl enable[^\n]*db-due/);
});

test('deploy-user sudo entrypoint permits only fixed health and passes SHA unchanged', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'db-due-entrypoint-'));
  try {
    const wrapper = path.join(dir, 'start-db-due');
    const log = path.join(dir, 'calls');
    await writeFile(wrapper, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_CALLS"\n', { mode: 0o755 });
    const original = await readFile('scripts/deploy/activate-release', 'utf8');
    const entrypoint = path.join(dir, 'activate-release');
    await writeFile(entrypoint, original.replace('/run/festival-radar-activation.lock', path.join(dir, 'lock'))
      .replace('/usr/local/libexec/festival-radar/start-db-due', wrapper), { mode: 0o755 });
    const sha = 'a'.repeat(40);
    const run = (args, caller = 'festival-radar-deploy') => spawnSync('bash', [entrypoint, ...args], {
      encoding: 'utf8', env: { ...process.env, SUDO_USER: caller, TEST_CALLS: log },
    });
    assert.equal(run([sha, 'due-health']).status, 0);
    assert.equal(await readFile(log, 'utf8'), sha + ' health\n');
    assert.equal(run([sha, 'due-ingest']).status, 2);
    assert.equal(run([sha, 'due-drain']).status, 2);
    assert.equal(run(['bad', 'due-health']).status, 2);
    assert.equal(run([sha, 'due-health'], 'other').status, 3);
    assert.equal(await readFile(log, 'utf8'), sha + ' health\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
