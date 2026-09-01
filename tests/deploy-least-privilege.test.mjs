import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production workflow uses the constrained deploy identity and wrapper", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");
  assert.match(workflow, /User festival-radar-deploy/);
  assert.match(workflow, /sudo -n \/usr\/local\/libexec\/festival-radar\/activate-release/);
  assert.match(workflow, /sudo -n \/usr\/local\/libexec\/festival-radar\/upgrade-deployment-assets/);
  assert.doesNotMatch(workflow, /User root/);
  assert.doesNotMatch(workflow, /production:\/tmp/);
});

test("bootstrap grants only the reviewed activation wrapper", async () => {
  const bootstrap = await readFile("scripts/deploy/bootstrap-deploy-user.sh", "utf8");
  assert.match(bootstrap, /NOPASSWD: \/usr\/local\/libexec\/festival-radar\/activate-release/);
  assert.match(bootstrap, /NOPASSWD: \/usr\/local\/libexec\/festival-radar\/upgrade-deployment-assets/);
  assert.doesNotMatch(bootstrap, /NOPASSWD:\s*ALL/);
  assert.match(bootstrap, /visudo -cf/);
});

test("privileged assets update only from the exact current main commit", async () => {
  const updater = await readFile("scripts/deploy/upgrade-deployment-assets", "utf8");
  assert.match(updater, /SUDO_USER/);
  assert.match(updater, /commits\/main/);
  assert.match(updater, /main_sha.*commit/);
  assert.match(updater, /raw\.githubusercontent\.com/);
  assert.match(updater, /bash -n/);
  assert.doesNotMatch(updater, /eval|source /);
});

test("activation wrapper validates caller, commit, input type, and owner", async () => {
  const wrapper = await readFile("scripts/deploy/activate-release", "utf8");
  assert.match(wrapper, /SUDO_USER/);
  assert.match(wrapper, /\[0-9a-f\]\{40\}/);
  assert.match(wrapper, /test ! -L/);
  assert.match(wrapper, /stat -c %U/);
});
