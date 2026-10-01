import { db } from "../lib/db.ts";
import { drainIngestionNotificationOutbox } from "../lib/ingestion/notification-outbox.ts";

// Explicit separate opt-in; no scheduler switch is included.
if (process.argv.length !== 3 || process.argv[2] !== "--db-due" || !process.env.DATABASE_URL) {
  throw new Error("Requires DATABASE_URL and explicit --db-due (no schedule installed)");
}
try {
  console.log(JSON.stringify({ delivered: await drainIngestionNotificationOutbox(db) }));
} finally {
  await db.$disconnect();
}
