import { constants, realpathSync } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const DIRECTORY = '/opt/festival-radar/shared/collection-jobs/ingestion';
// Output is always a pair of fixed labels. Reasons describe only the evidence
// boundary that failed, never the contents or location of private artifacts.
const evidence = (status, reason = 'safe-evidence') => ({ status, reason });
// The input is a trusted systemd start epoch; no caller-controlled paths.
export async function diagnoseLegacyArtifacts(startSeconds, directory = DIRECTORY, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!Number.isSafeInteger(startSeconds) || startSeconds <= 0 || startSeconds > nowSeconds + 60 || !Number.isSafeInteger(nowSeconds)) return evidence('unknown', 'start-invalid');
  try {
    const ancestors = [];
    for (let part = directory; part !== dirname(part); part = dirname(part)) ancestors.unshift(part);
    for (const part of ancestors) {
      const dir = await lstat(part);
      if (!dir.isDirectory() || dir.isSymbolicLink()) return evidence('unknown', 'collection-unsafe');
    }
  } catch (error) { return evidence('unknown', error?.code === 'ENOENT' ? 'collection-missing' : 'collection-unsafe'); }
  const inspect = async (name, readStatus) => {
    try {
      const file = directory + '/' + name;
      const metadata = await lstat(file);
      if (!metadata.isFile() || metadata.isSymbolicLink()) return { state: 'unsafe' };
      // A disappearance after lstat is not a cleanly missing artifact.
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => null);
      if (!handle) return { state: 'unsafe' };
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
          let json;
          try { json = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
          catch { return { state: 'invalid-evidence' }; }
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
  if (latest.state === 'unsafe') return evidence('unknown', 'final-file-unsafe');
  if (temporary.state === 'unsafe') return evidence('unknown', 'temp-file-unsafe');
  if (latest.state === 'invalid-evidence') return evidence('unknown', 'final-evidence-invalid');
  // systemctl prints whole seconds; the boundary cannot order attempts.
  if (latest.state === 'ambiguous' || temporary.state === 'ambiguous') return evidence('inconclusive');
  if (temporary.state === 'current') return evidence('current-temp');
  if (latest.state === 'current') return evidence(latest.status === 'completed' || latest.status === 'partial' ? 'current-success-artifact' : 'current-other-artifact');
  if (latest.state === 'older' && ['completed', 'partial'].includes(latest.status)) return evidence('retained-success-no-current-artifact');
  if (latest.state === 'missing' && temporary.state === 'missing') return evidence('no-artifact');
  return evidence('inconclusive');
}

// Accept only the exact failed oneshot snapshot; distinguish absent start from
// malformed start and other invalid systemd properties without forwarding text.
export function parseFailedStart(record) {
  if (typeof record !== 'string' || !record) return { start: null, reason: 'systemd-unavailable' };
  if (record.length > 640 || record.includes('\0')) return { start: null, reason: 'systemd-invalid' };
  const keys = ['LoadState', 'ActiveState', 'Result', 'ExecMainCode', 'ExecMainStatus', 'ExecMainStartTimestamp'];
  const lines = record.trimEnd().split('\n');
  const fields = {};
  for (const line of lines) {
    const n = line.indexOf('='); const key = line.slice(0, n);
    if (n < 1 || !keys.includes(key) || Object.hasOwn(fields, key)) return { start: null, reason: 'systemd-invalid' };
    fields[key] = line.slice(n + 1);
  }
  if (keys.slice(0, -1).some(key => !Object.hasOwn(fields, key)) ||
      fields.LoadState !== 'loaded' || fields.ActiveState !== 'failed' || fields.Result !== 'exit-code' ||
      fields.ExecMainCode !== '1' || fields.ExecMainStatus !== '1') return { start: null, reason: 'systemd-invalid' };
  if (!Object.hasOwn(fields, 'ExecMainStartTimestamp') || !fields.ExecMainStartTimestamp)
    return { start: null, reason: 'start-absent' };
  const stamp = fields.ExecMainStartTimestamp;
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2} (UTC|[A-Za-z]{2,6})$/.test(stamp))
    return { start: null, reason: 'start-invalid' };
  try {
    const seconds = execFileSync('/usr/bin/date', ['-d', stamp, '+%s'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[1-9][0-9]{0,11}$/.test(seconds) || !Number.isSafeInteger(Number(seconds))) throw new Error();
    return { start: Number(seconds), reason: 'safe-evidence' };
  } catch { return { start: null, reason: 'start-invalid' }; }
}

// Node canonicalizes import.meta.url but may retain a symlink in argv[1].
// Compare canonical paths so the packaged CLI cannot silently skip execution.
let isEntrypoint = false;
try { isEntrypoint = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
catch { /* Imported module or unavailable argv path. */ }
if (isEntrypoint) {
  let result = evidence('unknown', 'systemd-unavailable');
  try {
    if (process.argv.length === 2) {
      const chunks = []; let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 640) throw new Error();
        chunks.push(chunk);
      }
      const parsed = parseFailedStart(Buffer.concat(chunks).toString('utf8'));
      result = parsed.start === null ? evidence('unknown', parsed.reason) : await diagnoseLegacyArtifacts(parsed.start);
    }
  } catch { /* Never forward raw errors or contents. */ }
  process.stdout.write('DB_DUE_LEGACY_ARTIFACT status=' + result.status + ' reason=' + result.reason + '\n');
}
