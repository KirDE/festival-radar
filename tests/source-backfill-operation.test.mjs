import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

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
    await mkdir(mock);
    await writeFile(path.join(mock, "systemctl"), String.raw`#!/bin/sh
[ "$1" = start ] || exit 1
[ "$2" = festival-radar-source-backfill@preview.service ] || exit 1
if [ "$MOCK_MISSING_ENV" = 1 ]; then rm -f "$MOCK_ENV_FILE"; exit 1; fi
[ -f "$MOCK_ENV_FILE" ] || exit 1
[ "$(stat -c %a "$MOCK_ENV_FILE")" = 600 ] || exit 1
[ "$(stat -c %a "$MOCK_AUDIT_FILE")" = 600 ] || exit 1
[ "$(stat -c %a "$(dirname "$MOCK_ENV_FILE")")" = 700 ] || exit 1
cp "$MOCK_ENV_FILE" "$MOCK_CAPTURED_ENV"
nonce=$(sed -n 's/^SOURCE_BACKFILL_NONCE=//p' "$MOCK_CAPTURED_ENV")
# Simulate the service manager's append file descriptor (never journal stdout).
if [ "$MOCK_EMPTY" != 1 ]; then
  echo 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"ok","drift":0}' >> "$MOCK_AUDIT_FILE"
  if [ "$MOCK_SPOOF" = 1 ]; then
    printf 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"%s","status":"ok","url":"sensitive","drift":0}\n' "$nonce" >> "$MOCK_AUDIT_FILE"
  fi
  if [ "$MOCK_AUDIT" = 1 ]; then
    if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ] && [ "$MOCK_FAIL_WITH_OK" != 1 ]; then status=review-required; extra=',"counts":{"insert":2,"fill":0,"preserve":3}'; drift=1;
    elif [ "$MOCK_REVIEW" = 1 ]; then status=review-required; extra=''; drift=1;
    else status=ok; extra=''; drift=0; fi
    printf 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","nonce":"%s","status":"%s"%s,"drift":%s}\n' "$nonce" "$status" "$extra" "$drift" >> "$MOCK_AUDIT_FILE"
    cp "$MOCK_AUDIT_FILE" "$MOCK_AUDIT_CAPTURE"
    if [ "$MOCK_DUPLICATE" = 1 ]; then tail -n 1 "$MOCK_AUDIT_FILE" >> "$MOCK_AUDIT_FILE"; fi
  fi
  if [ "$MOCK_OVERSIZE" = 1 ]; then head -c 70000 /dev/zero | tr '\000' x >> "$MOCK_AUDIT_FILE"; fi
  if [ "$MOCK_LONG_LINE" = 1 ]; then head -c 2000 /dev/zero | tr '\000' x >> "$MOCK_AUDIT_FILE"; fi
  if [ "$MOCK_NUL" = 1 ]; then printf '\000' >> "$MOCK_AUDIT_FILE"; fi
  if [ "$MOCK_MANY_LINES" = 1 ]; then i=0; while [ "$i" -lt 201 ]; do echo noise >> "$MOCK_AUDIT_FILE"; i=$((i+1)); done; fi
  if [ "$MOCK_UNSAFE" = 1 ]; then chmod 644 "$MOCK_AUDIT_FILE"; fi
  if [ "$MOCK_MISSING_AUDIT" = 1 ]; then rm "$MOCK_AUDIT_FILE"; fi
fi
echo 'sensitive unit error' >&2
if [ "$MOCK_SYSTEMCTL_FAIL" = 1 ]; then exit 1; fi
`);
    await writeFile(path.join(mock, "head"), String.raw`#!/bin/sh
if [ "$MOCK_UNREADABLE" = 1 ]; then echo sensitive-read-error >&2; exit 1; fi
exec /usr/bin/head "$@"
`);
    execFileSync("chmod", ["+x", path.join(mock, "systemctl"), path.join(mock, "head")]);
    const capturedEnv = path.join(temporary, "captured-env");
    const auditCapture = path.join(temporary, "audit-capture");
    const auditFile = path.join(nonceDir, "preview.audit");
    const mockEnv = { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy", MOCK_ENV_FILE: path.join(nonceDir, "preview.env"), MOCK_AUDIT_FILE: auditFile, MOCK_AUDIT_CAPTURE: auditCapture, MOCK_CAPTURED_ENV: capturedEnv, MOCK_AUDIT: "1", MOCK_SYSTEMCTL_FAIL: "0" };
    const runMock = async (env = {}) => {
      await rm(capturedEnv, { force: true });
      await rm(auditCapture, { force: true });
      const result = spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...mockEnv, ...env } });
      const captured = await readFile(capturedEnv, "utf8").catch(() => "");
      if (captured) {
        const nonce = captured.trim().split("=")[1];
        assert.doesNotMatch(result.stdout + result.stderr, new RegExp(nonce));
        assert.doesNotMatch(result.stdout, /"nonce"/);
      }
      assert.equal(await readFile(auditFile, "utf8").catch(() => null), null);
      assert.equal(await readFile(mockEnv.MOCK_ENV_FILE, "utf8").catch(() => null), null);
      return result;
    };
    const valid = await runMock({ MOCK_SPOOF: "1" });
    assert.equal(valid.status, 0, valid.stderr);
    assert.doesNotMatch(valid.stderr, /sensitive/);
    assert.equal(valid.stdout.trim(), 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"ok","drift":0}');
    const nonce1 = (await readFile(capturedEnv, "utf8")).trim().split("=")[1];
    assert.match(nonce1, /^[0-9a-f]{64}$/);
    assert.equal((await stat(nonceDir)).mode & 0o777, 0o700);
    assert.match(await readFile(auditCapture, "utf8"), new RegExp(nonce1));
    assert.match(await readFile(auditCapture, "utf8"), /"url":"sensitive"/);
    // A prior root-owned file must be replaced, not appended to or trusted.
    await writeFile(auditFile, 'SOURCE_BACKFILL_AUDIT {"status":"stale"}\n');
    const next = await runMock();
    assert.equal(next.status, 0, next.stderr);
    assert.doesNotMatch(await readFile(auditCapture, "utf8"), /"status":"stale"/);
    assert.notEqual((await readFile(capturedEnv, "utf8")).trim().split("=")[1], nonce1);
    const outside = path.join(temporary, "outside");
    await writeFile(outside, "untouched\n");
    await symlink(outside, auditFile);
    assert.equal((await runMock()).status, 0);
    assert.equal(await readFile(outside, "utf8"), "untouched\n");
    const busy = spawnSync("flock", ["-x", lock, "bash", script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(busy.status, 5);
    assert.match(busy.stderr, /already running/);
    const failed = await runMock({ MOCK_SYSTEMCTL_FAIL: "1" });
    assert.equal(failed.status, 6);
    assert.equal(failed.stdout.trim(), 'SOURCE_BACKFILL_AUDIT {"operation":"festival-source-backfill","mode":"preview","status":"review-required","counts":{"insert":2,"fill":0,"preserve":3},"drift":1}');
    assert.match(failed.stderr, /systemctl start failed/);
    assert.doesNotMatch(failed.stderr, /sensitive/);
    const review = await runMock({ MOCK_REVIEW: "1" });
    assert.equal(review.status, 6);
    assert.equal(JSON.parse(review.stdout.slice("SOURCE_BACKFILL_AUDIT ".length)).status, "review-required");
    const failedWithOk = await runMock({ MOCK_SYSTEMCTL_FAIL: "1", MOCK_FAIL_WITH_OK: "1" });
    assert.equal(failedWithOk.status, 6);
    assert.match(failedWithOk.stdout, /"status":"ok"/);
    for (const env of [
      { MOCK_MISSING_ENV: "1" }, { MOCK_EMPTY: "1" }, { MOCK_AUDIT: "0" },
      { MOCK_AUDIT: "0", MOCK_SPOOF: "1" }, { MOCK_OVERSIZE: "1" },
      { MOCK_LONG_LINE: "1" }, { MOCK_UNREADABLE: "1" }, { MOCK_DUPLICATE: "1" },
      { MOCK_NUL: "1" }, { MOCK_MANY_LINES: "1" }, { MOCK_UNSAFE: "1" },
      { MOCK_MISSING_AUDIT: "1" },
    ]) {
      const result = await runMock(env);
      assert.equal(result.status, 6, JSON.stringify(env));
      assert.doesNotMatch(result.stdout, /SOURCE_BACKFILL_AUDIT|sensitive/);
      assert.doesNotMatch(result.stderr, /sensitive/);
    }
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
  assert.match(installer, /StandardOutput=append:\/run\/festival-radar-source-backfill\/%i\.audit/);
  assert.match(installer, /StandardError=journal/);
  assert.match(wrapper, /audit_file="\$nonce_dir\/\$mode\.audit"/);
  assert.doesNotMatch(wrapper.slice(wrapper.indexOf("  unit=\"festival-radar-source-backfill@\$mode.service\"")), /journalctl/);
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

test("runner reached through current symlink rejects invalid nonce instead of silently exiting", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "source-runner-symlink-"));
  try {
    // Keep the runner and its imports in the real release, like the production unit.
    await symlink(path.resolve("."), path.join(temporary, "current"));
    const runner = path.join(temporary, "current", "scripts", "deploy", "run-source-backfill.ts");
    for (const value of [undefined, "A".repeat(64)]) {
      const env = { ...process.env, DEPLOYED_COMMIT: sha, DATABASE_URL: "postgresql://localhost/festival_integration_test" };
      if (value === undefined) delete env.SOURCE_BACKFILL_NONCE;
      else env.SOURCE_BACKFILL_NONCE = value;
      const result = spawnSync(process.execPath, ["--experimental-strip-types", runner, "apply"], { env, encoding: "utf8" });
      assert.equal(result.status, 1, "runner must not silently exit via symlink: " + result.stderr);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /source operation guard rejected/);
      assert.doesNotMatch(result.stderr, /postgresql|Prisma|SOURCE_BACKFILL_AUDIT/);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("importing runner does not start an operation", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "source-runner-import-"));
  try {
    const runner = pathToFileURL(path.resolve("scripts/deploy/run-source-backfill.ts")).href;
    const importer = path.join(temporary, "importer.mjs");
    await writeFile(importer, "await import(" + JSON.stringify(runner) + ");\n");
    const env = { ...process.env, DEPLOYED_COMMIT: sha, DATABASE_URL: "postgresql://localhost/festival_integration_test" };
    delete env.SOURCE_BACKFILL_NONCE;
    const result = spawnSync(process.execPath, ["--experimental-strip-types", importer], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
