import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploy excludes both analytics endpoint spellings from proxy access logs", async () => {
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");
  const privacyBlock = installer.slice(installer.indexOf('nginx_vhost="'), installer.indexOf('chmod 0644 "$nginx_vhost"'));
  assert.match(privacyBlock, /vhost_nginx\.conf/);
  assert.match(privacyBlock, /location = \/api\/analytics\/page-view \{/);
  assert.match(privacyBlock, /location = \/api\/analytics\/page-view\/ \{/);
  assert.equal((privacyBlock.match(/access_log off;/g) || []).length, 2);
  assert.equal((privacyBlock.match(/proxy_pass http:\/\/127\.0\.0\.1:\$port;/g) || []).length, 2);
  assert.equal((privacyBlock.match(/proxy_set_header X-Real-IP "";/g) || []).length, 2);
  assert.equal((privacyBlock.match(/proxy_set_header X-Forwarded-For "";/g) || []).length, 2);
  assert.ok(installer.indexOf('chmod 0644 "$nginx_vhost"') < installer.indexOf('reconfigure-webserver.sh'), "privacy config must be installed before Plesk reconfiguration");
});
