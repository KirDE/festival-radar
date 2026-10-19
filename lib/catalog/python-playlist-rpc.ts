import { execFile } from 'node:child_process';

const MAX_BYTES = 8 * 1024 * 1024;

/** Pipe a single plan through the existing fenced provider adapter, never disk. */
export async function executePlaylistJson(
  executable: string, args: string[], value: unknown,
  options: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeout: number },
): Promise<unknown> {
  const input = JSON.stringify(value);
  if (typeof input !== 'string' || Buffer.byteLength(input) > MAX_BYTES) throw new Error('Playlist request too large');
  return new Promise((resolve, reject) => {
    let inputError: Error | undefined;
    const child = execFile(executable, args, { ...options, maxBuffer: MAX_BYTES, encoding: 'utf8' }, (error, stdout, stderr) => {
      // Keep provider exit codes and bounded diagnostics for the existing retry policy.
      if (error) { reject(Object.assign(error, { stdout, stderr })); return; }
      if (inputError) { reject(inputError); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid playlist provider reply')); }
    });
    child.stdin!.on('error', error => { inputError = error; });
    child.stdin!.end(input);
  });
}
