import { pathToFileURL } from 'node:url';

const pattern = /^DB_DUE_LEGACY_ARTIFACT status=(unknown|current-temp|current-success-artifact|current-other-artifact|retained-success-no-current-artifact|no-artifact|inconclusive)\n$/;
export function validateLegacyArtifact(input, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha) || !Buffer.isBuffer(input) || input.length > 256) throw new Error('artifact diagnostic rejected');
  const value = input.toString('utf8');
  if (!pattern.test(value) || !Buffer.from(value).equals(input)) throw new Error('artifact diagnostic rejected');
  return value;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let size = 0; const chunks = [];
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 256) throw new Error();
      chunks.push(chunk);
    }
    if (process.argv.length !== 3) throw new Error();
    process.stdout.write(validateLegacyArtifact(Buffer.concat(chunks), process.argv[2]));
  } catch {
    process.stderr.write('artifact diagnostic rejected\n');
    process.exitCode = 1;
  }
}
