import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const sha = "a".repeat(40);
const nl = String.fromCharCode(10);

test("source diagnosis reads bounded metadata without starting the unit or leaking logs", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "source-diagnose-"));
  try {
    const root = path.join(temp, "app");
    const release = path.join(root, "releases", sha);
    const unit = path.join(temp, "source-backfill@.service");
    const lock = path.join(temp, "activation.lock");
    const calls = path.join(temp, "calls");
    const bin = path.join(temp, "bin");
    await mkdir(path.join(release, "scripts", "deploy"), { recursive: true });
    await mkdir(path.join(release, ".runtime"));
    await mkdir(bin);
    await symlink(process.execPath, path.join(release, ".runtime", "node"));
    await writeFile(path.join(release, "DEPLOYED_COMMIT"), sha + nl);
    await writeFile(path.join(release, "scripts", "deploy", "run-source-backfill.ts"), "fixture");
    await writeFile(unit, "fixture");
    await symlink(release, path.join(root, "current"));
    const original = await readFile("scripts/deploy/activate-release", "utf8");
    const script = path.join(temp, "activate-release");
    await writeFile(script, original.replace("/run/festival-radar-activation.lock", lock)
      .replace("root=/opt/festival-radar", "root=" + root)
      .replace("/etc/systemd/system/festival-radar-source-backfill@.service", unit));
    await writeFile(path.join(bin, "systemctl"), ["#!/bin/sh", "echo systemctl >> \"$MOCK_CALLS\"", "echo SYSTEMCTL_SECRET >&2", "exit 9"].join(nl));
    await writeFile(path.join(bin, "journalctl"), [
      "#!/bin/sh",
      "echo \"$*\" >> \"$MOCK_CALLS\"",
      "if [ \"$MOCK_UNREADABLE\" = 1 ]; then echo JOURNAL_SECRET >&2; exit 9; fi",
      "case \" $* \" in",
      " *' _SYSTEMD_UNIT=festival-radar-source-backfill@preview.service _TRANSPORT=stdout _COMM=node '*) echo \"$MOCK_ENTRY1\" ;;",
      " *' _SYSTEMD_UNIT=festival-radar-source-backfill@preview.service _TRANSPORT=stdout '*) echo \"$MOCK_ENTRY1\"; echo \"$MOCK_ENTRY2\" ;;",
      " *' _SYSTEMD_UNIT=festival-radar-source-backfill@preview.service '*) echo \"$MOCK_ENTRY1\"; echo \"$MOCK_ENTRY2\"; echo \"$MOCK_ENTRY3\" ;;",
      " *' -u festival-radar-source-backfill@preview.service '*) echo \"$MOCK_ENTRY1\"; echo \"$MOCK_ENTRY2\"; echo \"$MOCK_ENTRY3\"; echo \"$MOCK_ENTRY4\" ;;",
      " *) echo WRONG_SELECTOR_SECRET >&2; exit 8 ;;",
      "esac",
    ].join(nl));
    await chmod(path.join(bin, "systemctl"), 0o755);
    await chmod(path.join(bin, "journalctl"), 0o755);
    const entries = [
      { _TRANSPORT: "stdout", _COMM: "node" },
      { _TRANSPORT: "stdout", _COMM: "secret_comm" },
      { _TRANSPORT: "journal", _COMM: "systemd" },
      { _COMM: "node" },
    ].map((fields) => JSON.stringify({ ...fields, MESSAGE: "PASSWORD_SECRET", CUSTOM: "TOKEN_SECRET", _SYSTEMD_INVOCATION_ID: "NONCE_SECRET" }));
    const env = { ...process.env, PATH: bin + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy", MOCK_CALLS: calls, MOCK_ENTRY1: entries[0], MOCK_ENTRY2: entries[1], MOCK_ENTRY3: entries[2], MOCK_ENTRY4: entries[3], MOCK_UNREADABLE: "0" };
    const run = (args = [sha, "source-diagnose"], overrides = {}) => spawnSync("bash", [script, ...args], { encoding: "utf8", env: { ...env, ...overrides } });
    for (const [args, overrides, expected] of [
      [[sha, "source-diagnose"], { SUDO_USER: "other" }, /unauthorized deploy caller/],
      [[sha, "source-diagnose", "extra"], {}, /invalid activation arguments/],
      [[sha, "source-diagnose;id"], {}, /invalid source operation/],
      [["b".repeat(40), "source-diagnose"], {}, /deployed commit mismatch/],
      [[sha.slice(0, -1) + "z", "source-diagnose"], {}, /invalid commit/],
    ]) assert.match(run(args, overrides).stderr, expected);
    assert.equal(await readFile(calls, "utf8").catch(() => ""), "");
    const busy = spawnSync("flock", ["-x", lock, "bash", script, sha, "source-diagnose"], { encoding: "utf8", env });
    assert.equal(busy.status, 5);
    assert.equal(await readFile(calls, "utf8").catch(() => ""), "");
    await writeFile(path.join(release, "DEPLOYED_COMMIT"), "b".repeat(40) + nl);
    assert.match(run().stderr, /release marker mismatch/);
    await writeFile(path.join(release, "DEPLOYED_COMMIT"), sha + nl);
    assert.equal(await readFile(calls, "utf8").catch(() => ""), "");
    const success = run();
    assert.equal(success.status, 0, success.stderr);
    assert.equal(success.stderr, "");
    assert.deepEqual(success.stdout.trim().split(nl).map((line) => line.match(/^SOURCE_DIAG (\S+) sample=(\d+)/)?.slice(1)), [
      ["exact", "1"], ["stdout", "2"], ["unit", "3"], ["unit-expanded", "4"],
    ]);
    assert.match(success.stdout, /unit-expanded sample=4 transport_stdout=2 transport_journal=1 transport_syslog=0 transport_other=0 transport_missing=1 comm_node=2 comm_systemd=1 comm_other=1 comm_missing=0/);
    assert.doesNotMatch(success.stdout + success.stderr, /SECRET|PASSWORD|TOKEN|NONCE|secret_comm|SOURCE_BACKFILL_AUDIT/);
    const selectors = (await readFile(calls, "utf8")).trim().split(nl);
    assert.equal(selectors.length, 4);
    for (const selector of selectors) assert.match(selector, /--since -2 hours -n 200/);
    assert.doesNotMatch(selectors.join(nl), /systemctl|start|apply/);
    await writeFile(calls, "");
    const unreadable = run(undefined, { MOCK_UNREADABLE: "1" });
    assert.equal(unreadable.status, 6);
    assert.equal(unreadable.stdout, "");
    assert.equal(unreadable.stderr.trim(), "source diagnostic journal unavailable");
    assert.doesNotMatch(await readFile(calls, "utf8"), /systemctl/);
    await writeFile(calls, "");
    const malformed = run(undefined, { MOCK_ENTRY1: "RAW_SECRET_NOT_JSON" });
    assert.equal(malformed.status, 6);
    assert.equal(malformed.stdout, "");
    assert.equal(malformed.stderr.trim(), "source diagnostic journal unavailable");
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("diagnostic workflow remains explicit and shares production guards", async () => {
  const workflow = await readFile(".github/workflows/source-backfill.yml", "utf8");
  assert.match(workflow, /options:/);
  assert.match(workflow, /- diagnose/);
  assert.ok(workflow.includes('case "$MODE" in preview|apply|verify|diagnose)'));
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: festival-radar-production/);
  assert.ok(workflow.includes('activate-release "$GITHUB_SHA" "source-$MODE"'));
});
