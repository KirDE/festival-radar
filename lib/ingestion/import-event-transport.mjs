import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export function validDispatchEvent(e) {
  if (!e || typeof e !== 'object' || !/^[a-f0-9]{64}$/.test(e.eventId)) return false;
  if (e.kind === 'probe') return Object.keys(e).sort().join() === 'eventId,kind';
  if (e.kind === 'repair') return Object.keys(e).sort().join() === 'eventId,kind,repairId' && /^[a-f0-9]{64}$/.test(e.repairId);
  return e.kind === 'source' && Object.keys(e).sort().join() === 'eventId,issueId,kind,sourceId' &&
    /^[a-zA-Z0-9_-]{1,160}$/.test(e.sourceId) && /^[a-f0-9]{64}$/.test(e.issueId);
}
export function transportConfigured(env = process.env) {
  return Boolean(env.IMPORT_EVENTS_SSH_TARGET && env.IMPORT_EVENTS_SSH_KEY_B64 && env.IMPORT_EVENTS_KNOWN_HOSTS);
}
export async function sendImportEvent(event, env = process.env) {
  if (!validDispatchEvent(event) || !transportConfigured(env) || !/^[a-z_][a-z0-9_-]*@[a-zA-Z0-9.-]+$/.test(env.IMPORT_EVENTS_SSH_TARGET)) throw new Error('Invalid import event transport');
  const dir = await mkdtemp(path.join(tmpdir(), 'import-event-'));
  try {
    const key = path.join(dir, 'key'), known = path.join(dir, 'known_hosts');
    await writeFile(key, Buffer.from(env.IMPORT_EVENTS_SSH_KEY_B64, 'base64'), { mode: 0o600 });
    await writeFile(known, env.IMPORT_EVENTS_KNOWN_HOSTS + '\n', { mode: 0o600 });
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/ssh', ['-F', '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ClearAllForwardings=yes',
        '-o', 'UserKnownHostsFile=' + known, '-i', key, env.IMPORT_EVENTS_SSH_TARGET, 'festival-import-event'], { stdio: ['pipe', 'pipe', 'ignore'] });
      let result = '', oversized = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 25_000);
      child.stdout.on('data', chunk => { if (result.length + chunk.length > 4096) { oversized = true; child.kill('SIGKILL'); } else result += chunk; });
      child.on('error', () => { clearTimeout(timer); reject(new Error('Import event transport unavailable')); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        try {
          const reply = JSON.parse(result);
          if (code !== 0 || oversized || reply.eventId !== event.eventId || reply.status !== 'accepted') throw new Error();
          resolve();
        } catch { reject(new Error('Import event not acknowledged')); }
      });
      child.stdin.end(JSON.stringify(event));
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
