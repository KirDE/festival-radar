import { db } from "../lib/db.ts";
import { drainIngestionNotificationOutbox } from "../lib/ingestion/notification-outbox.ts";

// Fixed bounded drain, used independently and by the opt-in tick.
if (process.argv.length !== 3 || process.argv[2] !== "--db-due" || !process.env.DATABASE_URL) {
  throw new Error("Requires DATABASE_URL and explicit --db-due (fixed batch cap 100)");
}
try {
  console.log(JSON.stringify({ delivered: await drainIngestionNotificationOutbox(db, { limit: 100 }) }));
} finally {
  await db.$disconnect();
}
