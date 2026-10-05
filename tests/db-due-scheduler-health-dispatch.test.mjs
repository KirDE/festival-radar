import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateSchedulerHealth } from '../scripts/validate-db-due-scheduler-health.mjs';

const sha = 'a'.repeat(40);
const record = {
  modeLegacy: 1, modeDbDue: 0, modeMissing: 0,
  tickMissing: 1, tickStale: 1, fetchError: 0, drainError: 0,
  legacyTimerEnabled: 'enabled', legacyTimerActive: 'active',
  dueTimerEnabled: 'disabled', dueTimerActive: 'inactive',
  legacyServiceActive: 'inactive', dueServiceActive: 'failed',
};
const marker = data => 'DB_DUE_SCHEDULER_HEALTH ' + JSON.stringify(data) + '\n';
const validate = text => validateSchedulerHealth(Buffer.from(text), sha);

test('only a single count-enum fixed-field diagnostic can be emitted', () => {
  assert.equal(validate(marker(record)), marker(record));
  for (const state of ['inactive', 'active', 'failed', 'missing', 'error']) {
    const data = { ...record, legacyServiceActive: state };
    assert.equal(validate(marker(data)), marker(data));
  }
  for (const state of ['missing', 'error']) {
    const data = { ...record, dueTimerEnabled: state, dueTimerActive: state };
    assert.equal(validate(marker(data)), marker(data));
  }
  const good = marker(record);
  for (const input of ['', good + good, 'private\n' + good, good + 'private\n', good + '\n', good.trimEnd(),
    good.replace('"modeLegacy":', '"modeLegacy":1,"modeLegacy":'),
    marker({ commit: sha, ...record }), good.replace('"failed"', '"activating"'), good.replace('"modeLegacy":1', '"modeLegacy":2'),
    marker({ ...record, modeMissing: 1 }), marker({ ...record, tickStale: 0 }),
    marker({ ...record, dueTimerActive: 'missing' }), marker({ ...record, raw: 'private' }),
    good.replace('"enabled"', '"enabled\\u0000"'), 'x'.repeat(2049)]) {
    assert.throws(() => validate(input), /scheduler diagnostic rejected/);
  }
  assert.throws(() => validateSchedulerHealth(Buffer.from(good), 'bad'), /rejected/);
});

test('manual main-only protected diagnostic shares production lock and never relays raw SSH', async () => {
  const workflow = await readFile('.github/workflows/db-due-scheduler-health.yml', 'utf8');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /inputs:|schedule:|preflight-ssh|due-switch|due-ingest|due-health\b/);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: festival-radar-production\n  cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /StrictHostKeyChecking yes/);
  assert.match(workflow, /User festival-radar-deploy/);
  assert.match(workflow, /ulimit -f 8; ssh .*activate-release "\$GITHUB_SHA" due-scheduler-health > "\$audit" 2>\/dev\/null/);
  assert.match(workflow, /node scripts\/validate-db-due-scheduler-health.mjs "\$GITHUB_SHA" < "\$audit"/);
  assert.doesNotMatch(workflow, /cat "\$audit"|tee|set -x/);
  const scheduler = await readFile('scripts/deploy/db-due-scheduler', 'utf8');
  const health = scheduler.slice(scheduler.indexOf('if [[ "$action" == health ]]; then'), scheduler.indexOf('lock="$root/shared'));
  assert.doesNotMatch(health, /systemctl (start|stop|enable|disable)|write_mode|rm |mv |curl|journalctl/);
});
