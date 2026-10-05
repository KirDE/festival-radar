import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const execute = promisify(execFile);
// Separate bounded operations: never skip drain because fetching failed or was idle.
export async function runTick(run) {
  const counts = { fetch_ok: 0, idle: 0, fetch_error: 0, drain_ok: 0, drain_error: 0, delivered: 0 };
  try {
    const summary = await run('fetch');
    if (summary.status === 'NO_DUE_SOURCES' && summary.attempted === 0) counts.idle = 1;
    else if (summary.attempted === 1 && summary.fetchErrors === 0 && ['COMPLETED', 'PARTIAL'].includes(summary.status)) counts.fetch_ok = 1;
    else throw new Error('Invalid bounded fetch result');
  } catch { counts.fetch_error = 1; }
  try {
    const result = await run('drain');
    if (!Number.isInteger(result.delivered) || result.delivered < 0 || result.delivered > 100) throw new Error('Invalid drain result');
    counts.drain_ok = 1;
    counts.delivered = result.delivered;
  } catch { counts.drain_error = 1; }
  return counts;
}

export function isTickEntrypoint(argument) {
  try { return Boolean(argument) && realpathSync(path.resolve(argument)) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isTickEntrypoint(process.argv[1])) {
  if (process.argv.length !== 2 || !process.env.DATABASE_URL) process.exitCode = 2;
  else {
    let output;
    try {
      output = await mkdtemp('/opt/festival-radar/shared/.db-due-tick.');
      const counts = await runTick(async (operation) => {
        const args = operation === 'fetch'
          ? ['scripts/ingest-festivals.mjs', '--db-due', '--publish', '--max-fetch-errors=0', `--output=${output}`]
          : ['scripts/drain-ingestion-notifications.mjs', '--db-due'];
        const { stdout } = await execute(process.execPath, args, {
          cwd: process.cwd(), timeout: operation === 'fetch' ? 1_100_000 : 120_000, maxBuffer: 1024 * 1024,
        });
        return JSON.parse(stdout);
      });
      console.log('DB_DUE_TICK ' + Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' '));
      if (counts.fetch_error || counts.drain_error) process.exitCode = 1;
    } catch { console.error('DB due tick unavailable'); process.exitCode = 1; }
    finally { if (output) await rm(path.resolve(output), { recursive: true, force: true }); }
  }
}
