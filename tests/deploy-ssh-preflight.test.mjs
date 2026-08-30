import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve("scripts/deploy/preflight-ssh.sh");

async function fakeSsh(exitCode) {
  const directory = await mkdtemp(path.join(tmpdir(), "festival-ssh-preflight-"));
  const log = path.join(directory, "calls.log");
  const ssh = path.join(directory, "ssh");
  await writeFile(
    ssh,
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" > "${log}"\necho 'sensitive ssh diagnostic' >&2\nexit ${exitCode}\n`,
  );
  await chmod(ssh, 0o755);
  return { directory, log };
}

test("performs a non-interactive SSH authentication preflight", async () => {
  const { directory, log } = await fakeSsh(0);
  const result = spawnSync("bash", [script, "production"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /preflight passed/);
  assert.equal(
    await readFile(log, "utf8"),
    "-o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 production true\n",
  );
});

test("returns actionable sanitized guidance when SSH is unavailable", async () => {
  const { directory } = await fakeSsh(255);
  const result = spawnSync("bash", [script, "production"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Verify the production deploy key, host, port, and known-hosts secret/);
  assert.doesNotMatch(result.stderr, /sensitive ssh diagnostic/);
});
