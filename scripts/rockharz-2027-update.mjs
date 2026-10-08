import { PLAN_HASH, ACTIVATION } from '../lib/operations/rockharz-2027-plan.ts';

// This client only talks to the application API; it has no database/SSH authority.
const { APP_URL, ROCKHARZ_2027_UPDATE_TOKEN: token, GITHUB_SHA: commit, GITHUB_RUN_ID: run,
  GITHUB_RUN_ATTEMPT: attempt, ROCKHARZ_ACTIVATION: activation, ROCKHARZ_OPERATION: operation = 'inspect' } = process.env;
if (activation !== ACTIVATION || !token || !/^[a-f0-9]{64}$/.test(token)
  || !/^[a-f0-9]{40}$/.test(commit ?? '') || !/^\d+$/.test(run ?? '') || !/^\d+$/.test(attempt ?? '')) {
  throw new Error('Exact activation and protected environment required');
}
if (!['inspect', 'activate', 'readback'].includes(operation)) throw new Error('Invalid operation');
const app = new URL(APP_URL ?? '');
if (app.protocol !== 'https:' || app.username || app.password || app.pathname !== '/' || app.search || app.hash) throw new Error('HTTPS application origin required');
const endpoint = new URL('/api/operations/rockharz-2027-update/', app);
const validId = (value) => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,120}$/.test(value);
async function call(operation) {
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, expectedCommit: commit, planHash: PLAN_HASH, runId: `${run}:${attempt}`,
      ...(operation === 'activate' ? { activation } : {}) }) });
  // Only print validated count-only results, never an untrusted error body.
  if (!response.ok) throw new Error(`Guarded ${operation} failed (HTTP ${response.status}); no automatic retry`);
  const result = await response.json();
  if (result.planHash !== PLAN_HASH || result.commit !== commit || result.operation !== 'UPDATE_EXISTING'
    || result.playlistJobs !== 0 || result.announced !== 27 || !validId(result.editionId)) throw new Error('Guarded response mismatch');
  if (operation === 'inspect') {
    if (result.status !== 'READY' || !Number.isInteger(result.reusedArtists) || !Number.isInteger(result.newArtists)
      || result.reusedArtists < 0 || result.newArtists < 0 || result.reusedArtists + result.newArtists !== 27) throw new Error('Preflight not ready');
  } else if (result.status !== 'VERIFIED' || result.festivalSlug !== 'rockharz' || result.editionYear !== 2027
    || result.headliners !== 1 || result.lineup !== 26 || result.sources !== 5 || result.provenance !== 9
    || result.playlistRefreshRequested !== false || !validId(result.auditId) || !validId(result.publicationId)) throw new Error('Readback mismatch');
  return { status: result.status, operation: 'UPDATE_EXISTING', commit, planHash: PLAN_HASH,
    editionId: result.editionId, announced: 27, playlistJobs: 0,
    ...(operation === 'inspect' ? { reusedArtists: result.reusedArtists, newArtists: result.newArtists }
      : { festivalSlug: 'rockharz', editionYear: 2027, headliners: 1, lineup: 26, sources: 5, provenance: 9,
        auditId: result.auditId, publicationId: result.publicationId, playlistRefreshRequested: false }) };
}
try {
  if (operation !== 'activate') {
    const result = await call(operation);
    console.log(JSON.stringify(result));
  } else {
    const preflight = await call('inspect');
    const applied = await call('activate');
    const readback = await call('readback');
    if (preflight.editionId !== applied.editionId || applied.editionId !== readback.editionId
      || applied.auditId !== readback.auditId || applied.publicationId !== readback.publicationId) throw new Error('Committed readback differs');
    console.log(JSON.stringify(readback));
  }
} catch {
  // A lost POST response can still mean a committed update. Never replay it.
  console.error('Guarded update stopped. Use authenticated readback to resolve outcome; do not retry activation blindly.');
  process.exitCode = 1;
}
