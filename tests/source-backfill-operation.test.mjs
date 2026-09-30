import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
    const nonceDir = path.join(temporary, "nonce-dir");
    await mkdir(path.join(release, "scripts", "deploy"), { recursive: true });
    await writeFile(path.join(release, "DEPLOYED_COMMIT"), sha + "\n");
    await writeFile(path.join(release, "scripts", "deploy", "run-source-backfill.ts"), "// fixture\n");
    await writeFile(unit, "// fixture\n");
    await symlink(release, path.join(root, "current"));
    const original = await readFile("scripts/deploy/activate-release", "utf8");
    const script = path.join(temporary, "activate-release");
    await writeFile(script, original.replace("/run/festival-radar-activation.lock", lock)
      .replace("root=/opt/festival-radar", "root=" + root)
      .replace("/run/festival-radar-source-backfill", nonceDir)
      .replaceAll("== 0:700", "== " + process.getuid() + ":700")
      .replaceAll("== 0:600", "== " + process.getuid() + ":600")
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
    const journalCalls = path.join(temporary, "journal-calls");
    await mkdir(mock);
    await writeFile(path.join(mock, "systemctl"), String.raw`#!/bin/sh
case "$1" in
  start)
    if [ "$MOCK_MISSING_ENV" = 1 ]; then rm -f "$MOCK_ENV_FILE"; exit 1; fi
    if [ ! -f "$MOCK_ENV_FILE" ]; then exit 1; fi
    [ "$(stat -c %a "$MOCK_ENV_FILE")" = 600 ] || exit 1
    [ "$(stat -c %a "$(dirname "$MOCK_ENV_FILE")")" = 700 ] || exit 1
    cp "$MOCK_ENV_FILE" "$MOCK_CAPTURED_ENV"
    echo 'sensitive unit error' >&2
    if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ]; then exit 1; fi ;;
esac
`);
    // Filter must require the exact unit and Node stdout; the mock emits only
    // the captured fresh nonce (or a stale/spoofed record for negative cases).
    await writeFile(path.join(mock, "journalctl"), String.raw`#!/bin/sh
case " $* " in
  *" --since=@"*" -n 200 _SYSTEMD_UNIT=festival-radar-source-backfill@preview.service _TRANSPORT=stdout _COMM=node "*)
    count=0
    if [ -f "$MOCK_JOURNAL_CALLS" ]; then count=$(cat "$MOCK_JOURNAL_CALLS"); fi
    count=$((count + 1))
    printf '%s\n' "$count" > "$MOCK_JOURNAL_CALLS"
    if [ "$MOCK_JOURNAL_UNREADABLE" = 1 ]; then echo 'sensitive journal error' >&2; exit 1; fi
    echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"ok","drift":0}'
    if [ "$MOCK_AUDIT" = 1 ] && [ "$count" -ge "$MOCK_AUDIT_AFTER" ]; then
      nonce=$(sed -n 's/^SOURCE_BACKFILL_NONCE=//p' "$MOCK_CAPTURED_ENV")
      if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ] && [ "$MOCK_FAIL_WITH_OK" != 1 ]; then status=review-required; extra=',"counts":{"insert":2,"fill":0,"preserve":3}'; drift=1;
      elif [ "$MOCK_REVIEW" = 1 ]; then status=review-required; extra=''; drift=1;
      else status=ok; extra=''; drift=0; fi
      printf 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"%s","status":"%s"%s,"drift":%s}\n' "$nonce" "$status" "$extra" "$drift"
    elif [ "$MOCK_SPOOF" = 1 ]; then
      nonce=$(sed -n 's/^SOURCE_BACKFILL_NONCE=//p' "$MOCK_CAPTURED_ENV")
      printf 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"%s","status":"ok","url":"sensitive","drift":0}\n' "$nonce"
    elif [ "$MOCK_JOURNAL_NO_MARKER" = 1 ]; then echo 'sensitive journal entry'; fi ;;
  *) echo 'sensitive unscoped journal entry' ;;
esac
`);
    await writeFile(path.join(mock, "sleep"), "#!/bin/sh\nexit 0\n");
    execFileSync("chmod", ["+x", path.join(mock, "systemctl"), path.join(mock, "journalctl"), path.join(mock, "sleep")]);
    const capturedEnv = path.join(temporary, "captured-env");
    const mockEnv = { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy", MOCK_ENV_FILE: path.join(nonceDir, "preview.env"), MOCK_CAPTURED_ENV: capturedEnv, MOCK_JOURNAL_CALLS: journalCalls, MOCK_AUDIT: "1", MOCK_AUDIT_AFTER: "1", MOCK_SYSTEMCTL_FAIL: "0", MOCK_JOURNAL_NO_MARKER: "0", MOCK_JOURNAL_UNREADABLE: "0", MOCK_SPOOF: "0" };
    const runMock = async (env = {}) => {
      await rm(capturedEnv, { force: true });
      await rm(journalCalls, { force: true });
      return spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...mockEnv, ...env } });
    };
    const valid = await runMock();
    assert.equal(valid.status, 0, valid.stderr);
    assert.doesNotMatch(valid.stderr, /sensitive/);
    assert.match(valid.stdout, /SOURCE_BACKFILL_AUDIT.*"status":"ok"/);
    const nonce1 = (await readFile(capturedEnv, "utf8")).trim().split("=")[1];
    assert.match(nonce1, /^[0-9a-f]{64}$/);
    assert.equal((await stat(nonceDir)).mode & 0o777, 0o700);
    assert.match(valid.stdout, new RegExp(nonce1));
    await assert.rejects(readFile(path.join(nonceDir, "preview.env")));
    const delayed = await runMock({ MOCK_AUDIT_AFTER: "3" });
    const nonce2 = (await readFile(capturedEnv, "utf8")).trim().split("=")[1];
    assert.notEqual(nonce2, nonce1);
    assert.match(delayed.stdout, new RegExp(nonce2));
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
    const failedWithOk = await runMock({ MOCK_SYSTEMCTL_FAIL: "1", MOCK_FAIL_WITH_OK: "1" });
    assert.equal(failedWithOk.status, 6);
    assert.match(failedWithOk.stdout, /"status":"ok"/);
    const missingEnv = await runMock({ MOCK_MISSING_ENV: "1", MOCK_AUDIT: "0" });
    assert.equal(missingEnv.status, 6);
    assert.doesNotMatch(missingEnv.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(missingEnv.stderr, /systemctl start failed/);
    const failedNoMarker = await runMock({ MOCK_SYSTEMCTL_FAIL: "1", MOCK_AUDIT: "0" });
    assert.equal(failedNoMarker.status, 6);
    assert.doesNotMatch(failedNoMarker.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(failedNoMarker.stderr, /systemctl start failed[\s\S]*journal no marker/);
    const noAudit = await runMock({ MOCK_AUDIT: "0" });
    assert.equal(noAudit.status, 6);
    assert.doesNotMatch(noAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(noAudit.stderr, /journal no marker/);
    assert.equal(await readFile(journalCalls, "utf8"), "10\n");
    // An old marker cannot satisfy the fresh invocation, even after retries.
    const staleAudit = await runMock({ MOCK_AUDIT: "0" });
    assert.equal(staleAudit.status, 6);
    assert.doesNotMatch(staleAudit.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(staleAudit.stderr, /journal no marker/);
    const review = await runMock({ MOCK_REVIEW: "1" });
    assert.equal(review.status, 6);
    assert.match(review.stdout, /"status":"review-required"/);
    assert.equal((await readFile(path.join(nonceDir, "preview.env")).catch(() => null)), null);
    const unreadable = await runMock({ MOCK_JOURNAL_UNREADABLE: "1" });
    assert.equal(unreadable.status, 6);
    assert.match(unreadable.stderr, /journal unreadable/);
    assert.doesNotMatch(unreadable.stderr, /sensitive/);
    const noMarker = await runMock({ MOCK_JOURNAL_NO_MARKER: "1", MOCK_AUDIT: "0" });
    assert.equal(noMarker.status, 6);
    assert.match(noMarker.stderr, /journal no marker/);
    assert.doesNotMatch(noMarker.stderr, /sensitive/);
    const spoofed = await runMock({ MOCK_AUDIT: "0", MOCK_SPOOF: "1" });
    assert.equal(spoofed.status, 6);
    assert.doesNotMatch(spoofed.stdout, /SOURCE_BACKFILL_AUDIT|sensitive/);
    assert.match(spoofed.stderr, /journal no marker/);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("packaged Node runner, app-user unit, and protected manual trigger only", async () => {
  const [packageScript, installer, workflow, bootstrap, runner, wrapper] = await Promise.all([
    readFile("scripts/deploy/package-release.sh", "utf8"),
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile(".github/workflows/source-backfill.yml", "utf8"),
    readFile("scripts/deploy/bootstrap-deploy-user.sh", "utf8"),
    readFile("scripts/deploy/run-source-backfill.ts", "utf8"),
    readFile("scripts/deploy/activate-release", "utf8"),
  ]);
  assert.match(packageScript, /cp scripts\/deploy\/run-source-backfill\.ts/);
  assert.match(installer, /ExecStart=.*\.runtime\/node --experimental-strip-types .*run-source-backfill\.ts %i/);
  assert.match(installer, /User=www-data[\s\S]*EnvironmentFile=\$shared\/production.env\nEnvironmentFile=\/run\/festival-radar-source-backfill\/%i.env/);
  assert.doesNotMatch(installer, /EnvironmentFile=-\/run\/festival-radar-source-backfill/);
  assert.doesNotMatch(installer, /enable --now "\$service-source-backfill/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*mode:/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /activate-release "\$GITHUB_SHA" "source-\$MODE"/);
  assert.doesNotMatch(workflow, /DATABASE_URL|sudo -n (?:bash|sh)|ssh production '.*(?:node|bash)/);
  assert.match(runner, /validNonce\(nonce\)/);
  assert.match(wrapper, /stat -c %u:%a/);
  assert.doesNotMatch(wrapper, /systemctl show|_SYSTEMD_INVOCATION_ID/);
  assert.doesNotMatch(bootstrap, /NOPASSWD:\s*ALL/);
});


test("runner rejects missing and malformed nonce before DB work or accepted audit", async () => {
  const runner = path.resolve("scripts/deploy/run-source-backfill.ts");
  for (const value of [undefined, "", "A".repeat(64), "a".repeat(63)]) {
    const env = { ...process.env, DEPLOYED_COMMIT: sha, DATABASE_URL: "postgresql://localhost/festival_integration_test" };
    if (value === undefined) delete env.SOURCE_BACKFILL_NONCE;
    else env.SOURCE_BACKFILL_NONCE = value;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", runner, "apply"], { env, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /source operation guard rejected/);
    assert.doesNotMatch(result.stderr, /postgresql|Prisma|SOURCE_BACKFILL_AUDIT/);
  }
});
