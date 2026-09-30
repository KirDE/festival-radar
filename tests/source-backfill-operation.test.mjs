import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const sha = "a".repeat(40);

test("fixed-mode wrapper rejects privilege, extra arguments, wrong commit, and arbitrary mode", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "source-operation-boundary-"));
  try {
    const root = path.join(temporary, "app");
    const release = path.join(root, "releases", sha);
    const unit = path.join(temporary, "source-backfill@.service");
    const lock = path.join(temporary, "activation.lock");
    await mkdir(path.join(release, "scripts", "deploy"), { recursive: true });
    await writeFile(path.join(release, "DEPLOYED_COMMIT"), sha + "\n");
    await writeFile(path.join(release, "scripts", "deploy", "run-source-backfill.ts"), "// fixture\n");
    await writeFile(unit, "// fixture\n");
    await symlink(release, path.join(root, "current"));
    const original = await readFile("scripts/deploy/activate-release", "utf8");
    const script = path.join(temporary, "activate-release");
    await writeFile(script, original.replace("/run/festival-radar-activation.lock", lock)
      .replace("root=/opt/festival-radar", "root=" + root)
      .replace("/etc/systemd/system/festival-radar-source-backfill@.service", unit));
    const run = (args, caller = "festival-radar-deploy") => spawnSync("bash", [script, ...args], {
      encoding: "utf8", env: { ...process.env, SUDO_USER: caller },
    });
    assert.match(run([sha, "source-preview"], "unprivileged").stderr, /unauthorized deploy caller/);
    assert.match(run([sha, "source-preview", "extra"]).stderr, /invalid activation arguments/);
    assert.match(run([sha, "source-preview;id"]).stderr, /invalid source operation/);
    assert.match(run(["b".repeat(40), "source-preview"]).stderr, /deployed commit mismatch/);
    assert.match(run([sha.slice(0, -1) + "z", "source-preview"]).stderr, /invalid commit/);
    const mock = path.join(temporary, "bin");
    const started = path.join(temporary, "started");
    const previousId = "a".repeat(32);
    const currentId = "b".repeat(32);
    await mkdir(mock);
    await writeFile(path.join(mock, "systemctl"), String.raw`#!/bin/sh
case "$1" in
  show)
    if [ -f "$MOCK_STARTED" ]; then printf '%s\n' "$MOCK_CURRENT_ID";
    else printf '%s\n' "$MOCK_PREVIOUS_ID"; fi ;;
  start)
    touch "$MOCK_STARTED"
    printf 'called:%s\n' "$*"
    if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ]; then exit 1; fi ;;
esac
`);
    // Unscoped journal reads contain an old audit; the new invocation only
    // contains an audit when MOCK_AUDIT=1. No cursor is available in either case.
    await writeFile(path.join(mock, "journalctl"), String.raw`#!/bin/sh
case " $* " in
  *" --show-cursor "*) exit 1 ;;
  *" _SYSTEMD_INVOCATION_ID=$MOCK_CURRENT_ID "*)
    if [ "$MOCK_AUDIT" = 1 ]; then echo 'SOURCE_BACKFILL_AUDIT {"mode":"preview","status":"ok"}'; fi ;;
  *) echo 'SOURCE_BACKFILL_AUDIT {"mode":"preview","status":"old"}' ;;
esac
`);
    execFileSync("chmod", ["+x", path.join(mock, "systemctl"), path.join(mock, "journalctl")]);
    const mockEnv = { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy", MOCK_STARTED: started, MOCK_PREVIOUS_ID: "", MOCK_CURRENT_ID: currentId, MOCK_AUDIT: "1", MOCK_SYSTEMCTL_FAIL: "0" };
    const runMock = async (env = {}) => {
      await rm(started, { force: true });
      return spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...mockEnv, ...env } });
    };
    const valid = await runMock();
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /called:start festival-radar-source-backfill@preview\.service/);
    assert.match(valid.stdout, /SOURCE_BACKFILL_AUDIT.*"status":"ok"/);
    const busy = spawnSync("flock", ["-x", lock, "bash", script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(busy.status, 5);
    assert.match(busy.stderr, /already running/);
    const failed = await runMock({ MOCK_SYSTEMCTL_FAIL: "1" });
    assert.equal(failed.status, 6);
    assert.match(failed.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(failed.stderr, /source operation failed/);
    const noAudit = await runMock({ MOCK_AUDIT: "0" });
    assert.equal(noAudit.status, 6);
    assert.doesNotMatch(noAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(noAudit.stderr, /source operation audit unavailable/);
    // A stale prior marker must not satisfy an invocation with no new audit.
    const staleAudit = await runMock({ MOCK_PREVIOUS_ID: previousId, MOCK_AUDIT: "0" });
    assert.equal(staleAudit.status, 6);
    assert.doesNotMatch(staleAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(staleAudit.stderr, /source operation audit unavailable/);
    const unchangedInvocation = await runMock({ MOCK_PREVIOUS_ID: previousId, MOCK_CURRENT_ID: previousId });
    assert.equal(unchangedInvocation.status, 6);
    assert.match(unchangedInvocation.stderr, /source operation audit unavailable/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("packaged Node runner, app-user unit, and protected manual trigger only", async () => {
  const [packageScript, installer, workflow, bootstrap] = await Promise.all([
    readFile("scripts/deploy/package-release.sh", "utf8"),
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile(".github/workflows/source-backfill.yml", "utf8"),
    readFile("scripts/deploy/bootstrap-deploy-user.sh", "utf8"),
  ]);
  assert.match(packageScript, /cp scripts\/deploy\/run-source-backfill\.ts/);
  assert.match(installer, /ExecStart=.*\.runtime\/node --experimental-strip-types .*run-source-backfill\.ts %i/);
  assert.match(installer, /User=www-data[\s\S]*EnvironmentFile=\$shared\/production.env/);
  assert.doesNotMatch(installer, /enable --now "\$service-source-backfill/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*mode:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /activate-release "\$GITHUB_SHA" "source-\$MODE"/);
  assert.doesNotMatch(workflow, /DATABASE_URL|sudo -n (?:bash|sh)|ssh production '.*(?:node|bash)/);
  assert.doesNotMatch(bootstrap, /NOPASSWD:\s*ALL/);
});
