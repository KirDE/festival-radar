import { db } from '../lib/db.ts';
import { dueWorkerHealth } from '../lib/ingestion/due-health.ts';

if (process.argv.length !== 2 || !process.env.DATABASE_URL) {
  console.error('DB due health prerequisites unavailable');
  process.exitCode = 2;
} else {
  try {
    console.log(JSON.stringify(await dueWorkerHealth(db)));
  } catch {
    console.error('DB due health query failed');
    process.exitCode = 1;
  } finally {
    await db.$disconnect().catch(() => { process.exitCode = 1; });
  }
}
