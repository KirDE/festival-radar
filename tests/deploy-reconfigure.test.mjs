import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/deploy/reconfigure-webserver.sh");

test("release packaging includes the helper required by the installer", async () => {
  const packager = await readFile("scripts/deploy/package-release.sh", "utf8");
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");

  assert.match(packager, /cp scripts\/deploy\/reconfigure-webserver\.sh/);
  assert.match(packager, /app\/scripts\/deploy\/reconfigure-webserver\.sh/);
  assert.match(installer, /scripts\/deploy\/reconfigure-webserver\.sh/);
});

test("release activation explicitly restarts an already-running service", async () => {
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");

  assert.match(installer, /systemctl enable "\$service"/);
  assert.match(installer, /systemctl restart "\$service"/);
  assert.doesNotMatch(installer, /systemctl enable --now "\$service"/);
});

async function executable(file, contents) {
  await writeFile(file, `#!/usr/bin/env bash\nset -euo pipefail\n${contents}\n`);
  await chmod(file, 0o755);
}

test("uses the supported Plesk httpdmng executable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-plesk-"));
  const log = path.join(directory, "calls.log");
  const httpdmng = path.join(directory, "httpdmng");
  await executable(httpdmng, `printf 'httpdmng:%s\\n' "$*" >> "${log}"`);

  const result = spawnSync("bash", [script, "festivals.kir-it.de"], {
    encoding: "utf8",
    env: { ...process.env, PLESK_HTTPDMNG: httpdmng },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(log, "utf8"), "httpdmng:--reconfigure-domain festivals.kir-it.de\n");
});

test("validates Apache before reloading when Plesk is unavailable", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-apache-"));
  const log = path.join(directory, "calls.log");
  await executable(path.join(directory, "apache2ctl"), `printf 'apache2ctl:%s\\n' "$*" >> "${log}"`);
  await executable(path.join(directory, "systemctl"), `printf 'systemctl:%s\\n' "$*" >> "${log}"`);

  const result = spawnSync("bash", [script, "festivals.kir-it.de"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      PLESK_HTTPDMNG: path.join(directory, "missing"),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await readFile(log, "utf8"),
    "apache2ctl:configtest\nsystemctl:reload apache2\n",
  );
});
