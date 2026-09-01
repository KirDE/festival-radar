import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("installer invokes only the bundled npm for production dependencies", async () => {
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");
  assert.match(installer, /\.runtime\/node" "\$release\/\.runtime\/npm\/bin\/npm-cli\.js"/);
  assert.match(installer, /ci --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(installer, /^npm\s+ci/m);
  assert.ok(
    installer.indexOf(".runtime/npm/bin/npm-cli.js") <
      installer.indexOf("node_modules/prisma/build/index.js generate"),
    "bundled npm must install dependencies before Prisma activation",
  );
});

test("release bundles a working npm that needs no system npm on PATH", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "festival-radar-release-"));
  try {
    await mkdir(path.join(temporary, ".next", "standalone"), { recursive: true });
    await mkdir(path.join(temporary, ".next", "static"), { recursive: true });
    await mkdir(path.join(temporary, "public"));
    await mkdir(path.join(temporary, "prisma"));
    await mkdir(path.join(temporary, "data"));
    await mkdir(path.join(temporary, "lib"));
    await mkdir(path.join(temporary, "scripts", "analytics"), { recursive: true });
    await mkdir(path.join(temporary, "scripts", "deploy"), { recursive: true });
    await mkdir(path.join(temporary, "scripts", "notifications"), { recursive: true });
    await writeFile(path.join(temporary, ".next", "standalone", "server.js"), "");
    await writeFile(
      path.join(temporary, "package.json"),
      JSON.stringify({ name: "portable-install-fixture", version: "1.0.0" }),
    );
    await writeFile(
      path.join(temporary, "package-lock.json"),
      JSON.stringify({
        name: "portable-install-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "portable-install-fixture", version: "1.0.0" } },
      }),
    );
    await writeFile(path.join(temporary, "scripts", "ingest-festivals.mjs"), "");
    await writeFile(path.join(temporary, "scripts", "deploy", "reconfigure-webserver.sh"), "#!/bin/sh\n");
    await writeFile(path.join(temporary, "scripts", "analytics", "prune-production.sh"), "#!/bin/sh\n");
    await writeFile(path.join(temporary, "scripts", "notifications", "dispatch-production.sh"), "#!/bin/sh\n");
    const archive = path.join(temporary, "release.tar.gz");
    execFileSync("bash", [path.resolve("scripts/deploy/package-release.sh"), "a".repeat(40), archive], {
      cwd: temporary,
      env: process.env,
    });
    execFileSync("tar", ["-xzf", archive, "-C", temporary]);
    const bundledVersion = execFileSync(
      path.join(temporary, "app", ".runtime", "node"),
      [path.join(temporary, "app", ".runtime", "npm", "bin", "npm-cli.js"), "--version"],
      { env: { PATH: "/nonexistent" }, encoding: "utf8" },
    ).trim();
    assert.equal(bundledVersion, (await readFile(path.join(temporary, "app", ".runtime", "NPM_VERSION"), "utf8")).trim());
    execFileSync(
      path.join(temporary, "app", ".runtime", "node"),
      [
        path.join(temporary, "app", ".runtime", "npm", "bin", "npm-cli.js"),
        "ci",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: path.join(temporary, "app"), env: { PATH: "/nonexistent" } },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
