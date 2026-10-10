import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquirePlaylistProcessLock } from '../lib/catalog/playlist-process-lock.ts';
import { playlistMode, queueActivationAudit, type QueueInventory } from '../lib/catalog/playlist-cutover.ts';
import { validateDisposableDatabase } from '../scripts/prepare-cutover-test-db.mjs';
const row: QueueInventory = { id: 'synthetic-job', publicationId: 'synthetic-publication', festivalSlug: 'synthetic-fest', status: 'PENDING', attempts: 0, leaseOwner: null, leaseExpiresAt: null, retryAt: null };

test('default mode preserves legacy work; only validated durable records grant DB mode', () => {
  assert.equal(playlistMode(undefined), 'legacy');
  assert.equal(playlistMode(null), 'legacy');
  assert.throws(() => playlistMode({ mode: 'database', enabled: true }));
  assert.equal(playlistMode({ version: 1, mode: 'database', reconciled: true, legacyDrained: true, commit: 'a'.repeat(40), queueHash: 'b'.repeat(64) }), 'database');
  assert.throws(() => playlistMode({ version: 1, mode: 'database', reconciled: false, commit: 'a'.repeat(40), queueHash: 'b'.repeat(64) }));
});
test('activation refuses live or unreconciled legacy attempts without resetting them', () => {
  assert.equal(queueActivationAudit([row]).reconciled, true);
  for (const overrides of [{ status: 'RUNNING' }, { status: 'FAILED' }, { leaseOwner: 'old-owner' }, { leaseExpiresAt: new Date() }]) {
    assert.equal(queueActivationAudit([{ ...row, ...overrides }]).reconciled, false);
  }
  const retry = { ...row, status: 'FAILED', retryAt: new Date('2027-01-01') };
  assert.equal(queueActivationAudit([retry]).reconciled, true);
  assert.notEqual(queueActivationAudit([row]).hash, queueActivationAudit([retry]).hash);
  assert.equal(row.status, 'PENDING');
});
test('test DB setup rejects production and remote targets before generation or migration', () => {
  validateDisposableDatabase('postgresql://test:test@127.0.0.1:5432/synthetic_integration');
  for (const url of ['postgresql://test:test@127.0.0.1/production', 'postgresql://test:test@remote.example/test', 'postgresql://test:test@localhost/test?host=remote', 'https://localhost/test']) assert.throws(() => validateDisposableDatabase(url));
});
test('release preserves old cadence and supported consumers share the same process lock', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  assert.match(installer, /install_collection_timer playlists 'Tue,Fri \*-\*-\* 04:17:00 UTC'/);
  assert.match(installer, /install_collection_timer playlists-db '\*-\*-\* \*:00\/10:00 UTC'/);
  assert.match(installer, /for collection_job in artist-identities source-monitor spotify-stats; do/);
  assert.match(installer, /install_collection_timer spotify-stats '\*-\*-\* \*:37:00 UTC'/);
  assert.match(installer, /playlist_install_select_mode/);
  assert.match(installer, /playlist_install_apply_mode/);
  const legacy = await readFile('scripts/deploy/run-legacy-playlists.sh', 'utf8');
  assert.match(legacy, /work="\$output\/work"/);
  assert.match(legacy, /cd "\$work"/);
  assert.match(legacy, /FESTIVAL_CATALOG="\$work\/tmp\/festival-playlist-catalog\.json"/);
  assert.match(legacy, /umask 077/);
  for (const file of ['app/api/playlists/run/route.ts', 'scripts/playlist-dispatch.ts', 'scripts/playlist-worker.ts', 'scripts/playlist-cutover.ts']) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /acquirePlaylistProcessLock/);
    assert.doesNotMatch(source, /PLAYLIST_DB_WORKER_ENABLED/);
  }
});
test('review commands are real, packaged, and CI DB tests generate/apply schema first', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  for (const name of ['test:final-cutover', 'test:final-cutover-db', 'catalog:audit-final', 'playlists:cutover']) assert.equal(typeof pkg.scripts[name], 'string');
  assert.equal(pkg.scripts['pretest:final-cutover-db'], 'node scripts/prepare-cutover-test-db.mjs');
  const setup = await readFile('scripts/prepare-cutover-test-db.mjs', 'utf8');
  assert.match(setup, /\['generate'\]/); assert.match(setup, /\['migrate', 'deploy'\]/);
  const packager = await readFile('scripts/deploy/package-release.sh', 'utf8');
  for (const file of ['audit-final-cutover.ts', 'playlist-cutover.ts', 'playlist-dispatch.ts']) assert.ok(packager.includes("grep -Fxq 'app/scripts/" + file + "'"));
  for (const file of ['read-playlist-install-mode.ts', 'playlist-timer-install.sh']) assert.ok(packager.includes("grep -Fxq 'app/scripts/deploy/" + file + "'"));
  const deploy = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.match(deploy, /vars.DB_ONLY_RELEASE/); assert.match(deploy, /secrets.DB_ONLY_CUTOVER_ATTESTATION/);
});

test('legacy and DB consumers cannot hold the process lock concurrently; release permits the next consumer', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'playlist-cutover-lock-'));
  const previous = process.env.APP_ROOT;
  process.env.APP_ROOT = root;
  try {
    const legacy = await acquirePlaylistProcessLock();
    try { await assert.rejects(acquirePlaylistProcessLock, /already running/); }
    finally { await legacy(); }
    const database = await acquirePlaylistProcessLock();
    await database();
  } finally {
    if (previous === undefined) delete process.env.APP_ROOT; else process.env.APP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
