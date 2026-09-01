import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("scheduler liveness is degraded until a delivery provider is configured", async () => {
  const directory = await mkdtemp(join(tmpdir(), "festival-notification-health-"));
  const stateFile = join(directory, "state.json");
  const finishedAt = new Date().toISOString();
  await writeFile(stateFile, JSON.stringify({ finishedAt, ok: true, processed: 0, statuses: {}, lastDeliveryAt: finishedAt, lastDeliveryStatuses: { sent: 1 } }));
  process.env.NOTIFICATION_SCHEDULER_STATE_FILE = stateFile;
  delete process.env.EMAIL_WEBHOOK_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.WEB_PUSH_WEBHOOK_URL;
  delete process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_KEY;
  const { GET } = await import("../app/api/health/notification-scheduler/route.ts");

  const degraded = await GET();
  assert.equal(degraded.status, 503);
  const degradedBody = await degraded.json();
  assert.equal(degradedBody.status, "degraded");
  assert.equal(degradedBody.schedulerStatus, "ok");
  assert.equal(degradedBody.deliveryReady, false);
  assert.deepEqual(degradedBody.providers, { EMAIL: false, TELEGRAM: false, WEB_PUSH: false });
  assert.deepEqual(degradedBody.lastDeliveryStatuses, { sent: 1 });
  assert.ok(degradedBody.ageSeconds >= 0 && degradedBody.ageSeconds <= 2);

  process.env.EMAIL_WEBHOOK_URL = "https://provider.example.test/email";
  const healthy = await GET();
  assert.equal(healthy.status, 200);
  const body = await healthy.json();
  assert.equal(body.status, "ok");
  assert.equal(body.schedulerStatus, "ok");
  assert.equal(body.deliveryReady, true);
  assert.deepEqual(body.providers, { EMAIL: true, TELEGRAM: false, WEB_PUSH: false });
  assert.deepEqual(body.lastDeliveryStatuses, { sent: 1 });
  await rm(directory, { recursive: true, force: true });
});
