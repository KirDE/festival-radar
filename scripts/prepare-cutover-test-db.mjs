import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function validateDisposableDatabase(value) {
  let url;
  try { url = new URL(value ?? ''); } catch { throw new Error('Local disposable test/integration PostgreSQL required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/(?:test|integration)/i.test(decodeURIComponent(url.pathname))
    || url.searchParams.has('host') || url.searchParams.has('hostaddr')) throw new Error('Local disposable test/integration PostgreSQL required');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateDisposableDatabase(process.env.DATABASE_URL);
  for (const args of [['generate'], ['migrate', 'deploy']]) {
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', ...args, '--schema', 'prisma/schema.prisma'], { stdio: 'inherit' });
  }
}
