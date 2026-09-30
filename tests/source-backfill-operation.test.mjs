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
    const journalCalls = path.join(temporary, "journal-calls");
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
    echo 'sensitive unit error' >&2
    if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ]; then exit 1; fi ;;
esac
`);
    // Only the Node stdout stream of the current unit/invocation may supply
    // an audit; other journal messages can contain spoofed marker text.
    await writeFile(path.join(mock, "journalctl"), String.raw`#!/bin/sh
case " $* " in
  *" --show-cursor "*) exit 1 ;;
  *" _SYSTEMD_UNIT=festival-radar-source-backfill@preview.service _SYSTEMD_INVOCATION_ID=$MOCK_CURRENT_ID _TRANSPORT=stdout _COMM=node "*)
    count=0
    if [ -f "$MOCK_JOURNAL_CALLS" ]; then count=$(cat "$MOCK_JOURNAL_CALLS"); fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$MOCK_JOURNAL_CALLS"
    if [ "$MOCK_JOURNAL_UNREADABLE" = 1 ]; then echo 'sensitive journal error' >&2; exit 1; fi
    if [ "$MOCK_AUDIT" = 1 ] && [ "$count" -ge "$MOCK_AUDIT_AFTER" ]; then
      if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ]; then
        echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"review-required","counts":{"insert":2,"fill":0,"preserve":3},"drift":1}'
      else
        echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"ok","drift":0}'
      fi
    elif [ "$MOCK_SPOOF" = 1 ]; then
      echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"ok","url":"sensitive","drift":0}'
    elif [ "$MOCK_JOURNAL_NO_MARKER" = 1 ]; then echo 'sensitive journal entry'; fi ;;
  *) echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"ok","drift":0}' ;;
esac
`);
    await writeFile(path.join(mock, "sleep"), "#!/bin/sh\nexit 0\n");
    execFileSync("chmod", ["+x", path.join(mock, "systemctl"), path.join(mock, "journalctl"), path.join(mock, "sleep")]);
    const mockEnv = { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy", MOCK_STARTED: started, MOCK_JOURNAL_CALLS: journalCalls, MOCK_PREVIOUS_ID: "", MOCK_CURRENT_ID: currentId, MOCK_AUDIT: "1", MOCK_AUDIT_AFTER: "1", MOCK_SYSTEMCTL_FAIL: "0", MOCK_JOURNAL_NO_MARKER: "0", MOCK_JOURNAL_UNREADABLE: "0", MOCK_SPOOF: "0" };
    const runMock = async (env = {}) => {
      await rm(started, { force: true });
      await rm(journalCalls, { force: true });
      return spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...mockEnv, ...env } });
    };
    const valid = await runMock();
    assert.equal(valid.status, 0, valid.stderr);
    assert.doesNotMatch(valid.stderr, /sensitive/);
    assert.match(valid.stdout, /SOURCE_BACKFILL_AUDIT.*"status":"ok"/);
    const delayed = await runMock({ MOCK_AUDIT_AFTER: "3", MOCK_PREVIOUS_ID: previousId });
    assert.equal(delayed.status, 0, delayed.stderr);
    assert.match(delayed.stdout, /SOURCE_BACKFILL_AUDIT.*"status":"ok"/);
    assert.equal(await readFile(journalCalls, "utf8"), "3\n");
    const busy = spawnSync("flock", ["-x", lock, "bash", script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(busy.status, 5);
    assert.match(busy.stderr, /already running/);
    const failed = await runMock({ MOCK_SYSTEMCTL_FAIL: "1" });
    assert.equal(failed.status, 6);
    assert.match(failed.stdout, /SOURCE_BACKFILL_AUDIT.*"status":"review-required".*"insert":2/);
    assert.match(failed.stderr, /systemctl start failed/);
    assert.doesNotMatch(failed.stderr, /sensitive/);
    assert.equal(await readFile(journalCalls, "utf8"), "1\n");
    const failedNoMarker = await runMock({ MOCK_SYSTEMCTL_FAIL: "1", MOCK_AUDIT: "0" });
    assert.equal(failedNoMarker.status, 6);
    assert.doesNotMatch(failedNoMarker.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(failedNoMarker.stderr, /systemctl start failed[\s\S]*current invocation journal empty/);
    const noAudit = await runMock({ MOCK_AUDIT: "0" });
    assert.equal(noAudit.status, 6);
    assert.doesNotMatch(noAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(noAudit.stderr, /current invocation journal empty/);
    assert.equal(await readFile(journalCalls, "utf8"), "10\n");
    // An old marker cannot satisfy the fresh invocation, even after retries.
    const staleAudit = await runMock({ MOCK_PREVIOUS_ID: previousId, MOCK_AUDIT: "0" });
    assert.equal(staleAudit.status, 6);
    assert.doesNotMatch(staleAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(staleAudit.stderr, /current invocation journal empty/);
    const unchangedInvocation = await runMock({ MOCK_PREVIOUS_ID: previousId, MOCK_CURRENT_ID: previousId });
    assert.equal(unchangedInvocation.status, 6);
    assert.match(unchangedInvocation.stderr, /new invocation unchanged/);
    await assert.rejects(readFile(journalCalls, "utf8"));
    const absentInvocation = await runMock({ MOCK_CURRENT_ID: "" });
    assert.equal(absentInvocation.status, 6);
    assert.match(absentInvocation.stderr, /new invocation absent or invalid/);
    const unreadable = await runMock({ MOCK_JOURNAL_UNREADABLE: "1" });
    assert.equal(unreadable.status, 6);
    assert.match(unreadable.stderr, /current invocation journal unreadable/);
    assert.doesNotMatch(unreadable.stderr, /sensitive/);
    const noMarker = await runMock({ MOCK_JOURNAL_NO_MARKER: "1", MOCK_AUDIT: "0" });
    assert.equal(noMarker.status, 6);
    assert.match(noMarker.stderr, /current invocation journal no marker/);
    assert.doesNotMatch(noMarker.stderr, /sensitive/);
    const spoofed = await runMock({ MOCK_AUDIT: "0", MOCK_SPOOF: "1" });
    assert.equal(spoofed.status, 6);
    assert.doesNotMatch(spoofed.stdout, /SOURCE_BACKFILL_AUDIT|sensitive/);
    assert.match(spoofed.stderr, /current invocation journal no marker/);
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
