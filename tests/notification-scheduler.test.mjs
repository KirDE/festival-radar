import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production owns notification scheduling and GitHub is manual diagnostics only", async () => {
  const [installer, workflow, runner, packager] = await Promise.all([
    readFile("scripts/deploy/install-release.sh", "utf8"),
    readFile(".github/workflows/notifications.yml", "utf8"),
    readFile("scripts/notifications/dispatch-production.sh", "utf8"),
    readFile("scripts/deploy/package-release.sh", "utf8"),
  ]);
  assert.match(installer, /OnUnitInactiveSec=10min/);
  assert.match(installer, /Persistent=true/);
  assert.match(installer, /systemctl enable --now "\$service-notifications.timer"/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
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
