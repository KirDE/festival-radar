import { drainImportEvents } from "../lib/ingestion/import-events.ts";
import { sendImportEvent, transportConfigured } from "../lib/ingestion/import-event-transport.mjs";
import { db } from "../lib/db.ts";
import { drainIngestionNotificationOutbox } from "../lib/ingestion/notification-outbox.ts";

// Fixed bounded drain, used independently and by the opt-in tick.
if (process.argv.length !== 3 || process.argv[2] !== "--db-due" || !process.env.DATABASE_URL) {
  throw new Error("Requires DATABASE_URL and explicit --db-due (fixed batch cap 100)");
}
try {
  // Existing importer tick drains its own durable events, including after an idle/failed fetch.
  // No OpenClaw-side timer, model health probe or queue observer is involved.
  const events = transportConfigured() ? await drainImportEvents(db, sendImportEvent) : { delivered: 0, failed: 0 };
  console.log(JSON.stringify({ delivered: await drainIngestionNotificationOutbox(db, { limit: 100 }), importEvents: events }));
} finally {
  await db.$disconnect();
}
