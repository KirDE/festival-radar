// This integration test mutates its database. Never let a remote or ambiguous
// connection string through, even when its database name contains "test".
export function requireLocalDisposableLogoDatabase(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('Local disposable test/integration DATABASE_URL required');
  const target = new URL(databaseUrl);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
    || target.searchParams.has('host') || target.searchParams.has('hostaddr')
    || !/^[a-zA-Z0-9_-]+$/.test(name) || !/(?:test|integration)/i.test(name)) {
    throw new Error('Local disposable test/integration DATABASE_URL required');
  }
  return name;
}
