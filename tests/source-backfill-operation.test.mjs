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
    await mkdir(mock);
    await writeFile(path.join(mock, "systemctl"), "#!/bin/sh\nprintf 'called:%s\\n' \"$*\"\n");
    await writeFile(path.join(mock, "journalctl"), "#!/bin/sh\necho 'SOURCE_BACKFILL_AUDIT {\"mode\":\"preview\",\"status\":\"ok\"}'\n");
    execFileSync("chmod", ["+x", path.join(mock, "systemctl"), path.join(mock, "journalctl")]);
    const valid = spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(valid.status, 0, valid.stderr);
    assert.match(valid.stdout, /SOURCE_BACKFILL_AUDIT/);
    const busy = spawnSync("flock", ["-x", lock, "bash", script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(busy.status, 5);
    assert.match(busy.stderr, /already running/);
    await writeFile(path.join(mock, "systemctl"), "#!/bin/sh\nexit 1\n");
    const failed = spawnSync("bash", [script, sha, "source-preview"], { encoding: "utf8", env: { ...process.env, PATH: mock + ":" + process.env.PATH, SUDO_USER: "festival-radar-deploy" } });
    assert.equal(failed.status, 6);
    assert.match(failed.stdout, /SOURCE_BACKFILL_AUDIT/);
    assert.match(failed.stderr, /source operation failed/);
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
