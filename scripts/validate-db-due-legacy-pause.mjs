import { pathToFileURL } from 'node:url';

export function validateLegacyPause(input, sha, remoteStatus) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !Buffer.isBuffer(input) || input.length > 128) throw new Error('pause diagnostic rejected');
  const text = input.toString('utf8');
  const match = /^DB_DUE_LEGACY_PAUSE status=(paused|refused|stop-error|disable-error|postcheck-error)\n$/.exec(text);
  if (!match || match[0] !== text || !Buffer.from(text).equals(input)) throw new Error('pause diagnostic rejected');
  if (!['0', '6'].includes(remoteStatus) || (match[1] === 'paused') !== (remoteStatus === '0')) throw new Error('pause diagnostic rejected');
  return { marker: `DB_DUE_LEGACY_PAUSE status=${match[1]}\n`, ok: match[1] === 'paused' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let size = 0; const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length; if (size > 128) throw new Error();
      chunks.push(chunk);
    }
    if (process.argv.length !== 4) throw new Error();
    const result = validateLegacyPause(Buffer.concat(chunks), process.argv[2], process.argv[3]);
    process.stdout.write(result.marker);
    process.exitCode = result.ok ? 0 : 1;
  } catch {
    process.stderr.write('pause diagnostic rejected\n'); process.exitCode = 1;
  }
}
