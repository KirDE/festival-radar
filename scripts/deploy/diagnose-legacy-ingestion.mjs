import { constants, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIRECTORY = '/opt/festival-radar/shared/collection-jobs/ingestion';
// The input is a trusted systemd start epoch; no caller-controlled paths.
export async function diagnoseLegacyArtifacts(startSeconds, directory = DIRECTORY, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(startSeconds) || startSeconds <= 0 || startSeconds > nowSeconds + 60 || !Number.isSafeInteger(nowSeconds)) return 'unknown';
  try {
    for (let part = directory; part !== dirname(part); part = dirname(part)) {
      const dir = await lstat(part);
      if (!dir.isDirectory() || dir.isSymbolicLink()) return 'unknown';
    }
  } catch { return 'unknown'; }
  const inspect = async (name, readStatus) => {
    try {
      const file = directory + '/' + name;
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return { state: 'unsafe' };
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.ino !== metadata.ino || stat.dev !== metadata.dev ||
            !Number.isFinite(stat.mtimeMs) || stat.mtimeMs > (nowSeconds + 60) * 1000 ||
            stat.size < 0 || stat.size > (readStatus ? 65536 : 1048576)) return { state: 'unsafe' };
        let status = 'unknown';
        if (readStatus) {
          const buffer = Buffer.alloc(stat.size + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead !== stat.size) return { state: 'unsafe' };
          const json = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
          if (json && typeof json === 'object' && !Array.isArray(json) &&
              json.summary && typeof json.summary === 'object' && !Array.isArray(json.summary) &&
              json.readBack && typeof json.readBack === 'object' && !Array.isArray(json.readBack) &&
              ['COMPLETED', 'PARTIAL', 'FAILED'].includes(json.summary.status) &&
              json.summary.status === json.readBack.status) status = json.summary.status.toLowerCase();
        }
        return { state: stat.mtimeMs >= (startSeconds + 1) * 1000 ? 'current' :
          stat.mtimeMs < startSeconds * 1000 ? 'older' : 'ambiguous', status };
      } finally { await handle.close(); }
    } catch (error) { return { state: error?.code === 'ENOENT' ? 'missing' : 'unsafe' }; }
  };
  const [latest, temporary] = await Promise.all([inspect('latest.json', true), inspect('latest.json.tmp', false)]);
  if (latest.state === 'unsafe' || temporary.state === 'unsafe') return 'unknown';
  // systemctl prints whole seconds; the boundary cannot order attempts.
  if (latest.state === 'ambiguous' || temporary.state === 'ambiguous') return 'inconclusive';
  if (temporary.state === 'current') return 'current-temp';
  if (latest.state === 'current') return latest.status === 'completed' || latest.status === 'partial' ? 'current-success-artifact' : 'current-other-artifact';
  if (latest.state === 'older' && ['completed', 'partial'].includes(latest.status)) return 'retained-success-no-current-artifact';
  if (latest.state === 'missing' && temporary.state === 'missing') return 'no-artifact';
  return 'inconclusive';
}

// Never return systemd output, timestamps or errors. An untrusted duplicate,
// absent property or malformed timestamp is simply unknown.
export function parseFailedStart(record) {
  if (typeof record !== 'string' || record.length > 640 || record.includes('\0')) return null;
  const keys = ['LoadState', 'ActiveState', 'Result', 'ExecMainCode', 'ExecMainStatus', 'ExecMainStartTimestamp'];
  const lines = record.trimEnd().split('\n');
  if (lines.length !== keys.length) return null;
  const fields = {};
  for (const line of lines) {
    const n = line.indexOf('='); const key = line.slice(0, n);
    if (n < 1 || !keys.includes(key) || Object.hasOwn(fields, key)) return null;
    fields[key] = line.slice(n + 1);
  }
  if (fields.LoadState !== 'loaded' || fields.ActiveState !== 'failed' || fields.Result !== 'exit-code' ||
      fields.ExecMainCode !== '1' || fields.ExecMainStatus !== '1') return null;
  const stamp = fields.ExecMainStartTimestamp;
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} (UTC|[A-Za-z]{2,6})$/.test(stamp)) return null;
  try {
    const seconds = execFileSync('/usr/bin/date', ['-d', stamp, '+%s'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[1-9][0-9]{0,11}$/.test(seconds) ? Number(seconds) : null;
  } catch { return null; }
}

// Node canonicalizes import.meta.url but may retain a symlink in argv[1].
// Compare canonical paths so the packaged CLI cannot silently skip execution.
let isEntrypoint = false;
try { isEntrypoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
catch { /* Imported module or unavailable argv path. */ }
if (isEntrypoint) {
  let result = 'unknown';
  try {
    if (process.argv.length === 2) {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 640) throw new Error();
        chunks.push(chunk);
      }
      const start = parseFailedStart(Buffer.concat(chunks).toString('utf8'));
      if (start !== null) result = await diagnoseLegacyArtifacts(start);
    }
  } catch { /* Never forward raw errors or contents. */ }
  process.stdout.write('DB_DUE_LEGACY_ARTIFACT status=' + result + '\n');
}
