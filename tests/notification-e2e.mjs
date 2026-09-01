import assert from "node:assert/strict";
import { createServer } from "node:http";
import { NotificationChannel, NotificationEventType, NotificationFrequency, NotificationStatus } from "@prisma/client";
import { db } from "../lib/db.ts";
import { notificationEventsForChanges } from "../lib/ingestion/notification-events.ts";
import { dispatchDue, recordChange } from "../lib/notifications.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const requests = [];
const provider = createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    requests.push({ idempotencyKey: request.headers["idempotency-key"], body: JSON.parse(body) });
    response.writeHead(202).end("accepted");
  });
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const address = provider.address();
if (!address || typeof address === "string") throw new Error("Provider did not bind");
process.env.EMAIL_WEBHOOK_URL = `http://127.0.0.1:${address.port}/email`;

try {
  await db.notificationDelivery.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.notificationPreference.deleteMany();
  const user = await db.user.create({ data: { email: "staging-notifications@example.test", passwordHash: "not-used", emailVerifiedAt: new Date() } });
  await db.notificationPreference.create({ data: { userId: user.id, festivalId: "test-fest:2027", eventType: NotificationEventType.ARTIST_ADDED, channel: NotificationChannel.EMAIL, frequency: NotificationFrequency.IMMEDIATE } });
  const [eventInput] = notificationEventsForChanges(
    { slug: "test-fest", name: "Test Fest", country: "DE", countryCode: "DE", officialUrl: "https://example.test", headliners: [], lineup: [], status: "confirmed", editionYear: 2027 },
    [{ kind: "artist_added", field: "lineup", after: "New Band", reviewRequired: false }],
    new Date().toISOString(),
  );
  await recordChange({ ...eventInput, occurredAt: new Date(eventInput.occurredAt) });
  await recordChange({ ...eventInput, occurredAt: new Date(eventInput.occurredAt) });

  assert.equal(await db.notificationEvent.count({ where: { dedupeKey: eventInput.dedupeKey } }), 1, "detected change must persist once");
  assert.equal(await db.notificationDelivery.count({ where: { event: { dedupeKey: eventInput.dedupeKey } } }), 1, "deduplicated event must create one delivery");
  await Promise.all([dispatchDue(undefined, 100), dispatchDue(undefined, 100)]);
  assert.equal(requests.length, 1, "overlapping dispatchers must issue one provider request");
  const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { event: { dedupeKey: eventInput.dedupeKey } } });
  assert.equal(delivery.status, NotificationStatus.SENT);
  assert.equal(requests[0].idempotencyKey, delivery.id);
  assert.equal(requests[0].body.deliveryId, delivery.id);
  console.log(JSON.stringify({ event: "persisted", delivery: "sent", providerRequests: requests.length, overlappingWorkers: 2 }));
} finally {
  await db.$disconnect();
  await new Promise((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
}
