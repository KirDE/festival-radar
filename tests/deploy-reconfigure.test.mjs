import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/deploy/reconfigure-webserver.sh");

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
