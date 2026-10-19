import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production owns notification scheduling", async () => {
  const [installer, runner, packager] = await Promise.all([
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile("scripts/notifications/dispatch-production.sh", "utf8"),
    readFile("scripts/deploy/package-release.sh", "utf8"),
  ]);
  assert.match(installer, /OnUnitInactiveSec=10min/);
  assert.match(installer, /Persistent=true/);
  assert.match(installer, /systemctl enable --now "\$service-notifications.timer"/);
  assert.match(runner, /flock -n/);
  assert.match(runner, /authorization: Bearer \$INTERNAL_API_SECRET/);
  assert.doesNotMatch(runner, /--fail-with-body/);
  assert.match(runner, /--write-out '%\{http_code\}'/);
  assert.match(runner, /\[\[ "\$http_status" == 2\?\? \]\]/);
  assert.doesNotMatch(runner, /INTERNAL_API_SECRET.*state_file/);
  assert.match(runner, /lastDeliveryAt: hadDelivery \? finishedAt : previous\.lastDeliveryAt/);
  assert.match(runner, /lastDeliveryStatuses: hadDelivery \? statuses : previous\.lastDeliveryStatuses/);
  assert.match(packager, /scripts\/notifications\/dispatch-production\.sh/);
});
