import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/** Shared with the historical collection runner. Held through DB acknowledgement. */
export async function acquirePlaylistProcessLock() {
  const directory = path.join(process.env.APP_ROOT ?? '/opt/festival-radar', 'shared/collection-jobs/playlists');
  await mkdir(directory, { recursive: true, mode: 0o750 });
  const holder = spawn('flock', ['--exclusive', '--nonblock', path.join(directory, 'refresh.lock'),
    'sh', '-c', 'printf "LOCKED\\n"; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
  holder.stdin.on('error', () => { /* An exited lock holder cannot accept stdin. */ });
  const exited = new Promise<void>(resolve => holder.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => { holder.kill(); reject(new Error('Playlist lock unavailable')); }, 5000);
      const cleanup = () => clearTimeout(timeout);
      holder.once('error', () => { cleanup(); reject(new Error('Playlist lock unavailable')); });
      holder.once('close', () => { cleanup(); reject(new Error('Playlist operation already running')); });
      holder.stdout.on('data', chunk => {
        output += chunk.toString();
        if (output === 'LOCKED\n') { cleanup(); resolve(); }
        else if (output.length > 16) { cleanup(); holder.kill(); reject(new Error('Invalid playlist lock response')); }
      });
    });
  } catch (error) { holder.stdin.end(); throw error; }
  return async () => { holder.stdin.end(); await exited; };
}
