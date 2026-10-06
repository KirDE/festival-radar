import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const worktreeRoot = fileURLToPath(new URL('../../', import.meta.url));

export const BOUNDS = Object.freeze({ sources: 1000, candidates: 1000, evidence: 100, diffs: 100 });
class QueueError extends Error {}
const fail = (message) => { throw new QueueError(message); };
export function parseArgs(args) {
  let expectedHead, limit = 50;
  const seen = new Set();
  for (const arg of args) {
    const match = /^--(expected-head|limit)=(.*)$/.exec(arg);
    if (!match || seen.has(match[1])) fail('Invalid arguments');
    seen.add(match[1]);
    if (match[1] === 'expected-head') expectedHead = match[2];
    else {
      if (!/^[1-9][0-9]*$/.test(match[2])) fail('Invalid limit');
      limit = Number(match[2]);
    }
  }
  if (!/^[0-9a-fA-F]{40}$/.test(expectedHead ?? '')) fail('Requires --expected-head=<40hex>');
  if (!Number.isSafeInteger(limit) || limit > 100) fail('Limit must be 1..100');
  return { expectedHead: expectedHead.toLowerCase(), limit };
}
// Git metadata is intentionally absent from packaged releases. The active,
// stamped exact release is the only alternative to a matching Git worktree.
export function validatedDeployedRevision(root, current, stamped) {
  const match = /^\/opt\/festival-radar\/releases\/([0-9a-f]{40})$/.exec(root);
  return match && root === current && match[1] === stamped ? stamped : null;
}
function readActiveRevision() {
  const root = realpathSync(worktreeRoot);
  if (root.startsWith('/opt/festival-radar/releases/')) {
    return validatedDeployedRevision(root, realpathSync('/opt/festival-radar/current'),
      readFileSync(new URL('../../DEPLOYED_COMMIT', import.meta.url), 'utf8').trim());
  }
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: worktreeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(top) !== root) return null;
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
export function guardHead(expectedHead, readHead = readActiveRevision) {
  if (readHead() !== expectedHead) fail('Exact release mismatch');
}
export function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href;
  } catch { return null; }
}
// Only festival facts enter the hash; provenance IDs, URLs, warnings and observation
// timestamps do not. Festival dates and timetable start times are meaningful facts.
const factFields = ['startDate', 'endDate', 'city', 'headliners', 'lineup', 'ticketStatus', 'status', 'editionYear', 'observedEditionYears'];
const timetableFields = ['date', 'stage', 'start', 'artist', 'timeZone', 'status'];
const pick = (value, fields) => Object.fromEntries(fields.filter((key) => Object.hasOwn(value ?? {}, key)).map((key) => [key, value[key]]));
function canonicalJson(value) {
  const canonical = (item) => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item;
  return JSON.stringify(canonical(value));
}
const stableSet = (rows) => [...new Set(rows.map(canonicalJson))].sort().map((row) => JSON.parse(row));
export function normalizedFingerprint(value, evidence = [], diffs = [], sourceYear = null) {
  const facts = pick(value, factFields);
  if (Object.hasOwn(value ?? {}, 'ticketsUrl')) facts.ticketsUrl = safeUrl(value.ticketsUrl);
  if (Array.isArray(value?.timetable)) facts.timetable = value.timetable.map((row) => pick(row, timetableFields));
  const meaningful = { sourceYear, facts,
    // Hash original metadata rather than redacted tokens so invalid metadata cannot
    // collapse distinct evidence into an identical signature. Only the digest escapes.
    evidence: stableSet(evidence.map((e) => ({ field: e.field, contentHash: hash(e.contentHash) ?? e.contentHash, adapter: e.adapter }))),
    diffs: stableSet(diffs.map((d) => pick(d, ['field', 'reviewRequired', 'policyVersion']))),
  };
  return createHash('sha256').update(canonicalJson(meaningful)).digest('hex');
}
const token = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.:+-]{1,160}$/.test(value) ? value : null;
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
const iso = (value) => value ? new Date(value).toISOString() : null;
const identity = (slug, url) => JSON.stringify([slug, url]);
const attemptSelect = { id: true, runId: true, festivalSlug: true, requestedUrl: true, finalUrl: true, status: true, startedAt: true, endedAt: true };
const attemptOrder = [{ startedAt: 'desc' }, { endedAt: 'desc' }, { id: 'desc' }];
const sourceSelect = { id: true, festivalId: true, editionId: true, festivalSlug: true, url: true, fetchUrl: true, parserKey: true, strategies: true, enabled: true, editionYear: true, createdAt: true, updatedAt: true, lastAttemptAt: true, configurationBackfilledAt: true };
const diffSelect = { field: true, reviewRequired: true, policyVersion: true };
const diffMetadata = (d) => ({ field: token(d.field), reviewRequired: d.reviewRequired, policyVersion: token(d.policyVersion) });
const evidenceSelect = { id: true, field: true, sourceUrl: true, contentHash: true, observedAt: true, adapter: true };
function bounded(rows, bound) { if (rows.length > bound) fail('Scan truncated; no queue exported'); return rows; }
function sourceMetadata(s) {
  return s ? { id: token(s.id), festivalId: token(s.festivalId), editionId: token(s.editionId), parserKey: token(s.parserKey), editionYear: s.editionYear, url: safeUrl(s.url), fetchUrl: safeUrl(s.fetchUrl), createdAt: iso(s.createdAt), updatedAt: iso(s.updatedAt), configurationBackfilledAt: iso(s.configurationBackfilledAt) } : null;
}
function attemptMetadata(a) {
  return a ? { id: token(a.id), runId: token(a.runId), status: token(a.status), requestedUrl: safeUrl(a.requestedUrl), finalUrl: safeUrl(a.finalUrl), startedAt: iso(a.startedAt), endedAt: iso(a.endedAt) } : null;
}

export async function readReviewQueue(db, { limit = 50 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Limit must be 1..100');
  const sources = bounded(await db.festivalSource.findMany({ take: BOUNDS.sources + 1, orderBy: { id: 'asc' }, select: sourceSelect }), BOUNDS.sources);
  const candidates = bounded(await db.ingestionCandidate.findMany({
    where: { reviewState: 'PENDING', attempt: { status: 'REVIEW' } },
    take: BOUNDS.candidates + 1, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, runId: true, attemptId: true, festivalSlug: true, schemaVersion: true, sourceYear: true, createdAt: true, normalized: true, attempt: { select: attemptSelect },
      evidence: { take: BOUNDS.evidence + 1, orderBy: { id: 'asc' }, select: evidenceSelect },
      diffs: { take: BOUNDS.diffs + 1, orderBy: { id: 'asc' }, select: diffSelect } },
  }), BOUNDS.candidates);
  for (const c of candidates) { bounded(c.evidence, BOUNDS.evidence); bounded(c.diffs, BOUNDS.diffs); }
  const groups = new Map();
  for (const s of sources) {
    if (s.enabled && s.strategies.includes('manual_review')) groups.set(identity(s.festivalSlug, s.url), { source: s, candidates: [] });
  }
  for (const c of candidates) {
    const key = identity(c.festivalSlug, c.attempt.requestedUrl);
    if (!groups.has(key)) groups.set(key, { source: sources.find((s) => identity(s.festivalSlug, s.url) === key), candidates: [] });
    groups.get(key).candidates.push(c);
  }
  // One bounded latest-attempt lookup per identity (at most sources + candidates).
  const entries = [];
  for (const [key, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const [festivalSlug, requestedUrl] = JSON.parse(key);
    const latest = await db.ingestionAttempt.findFirst({ where: { festivalSlug, requestedUrl }, orderBy: attemptOrder, select: attemptSelect });
    group.candidates.sort((a, b) => new Date(b.attempt.startedAt) - new Date(a.attempt.startedAt) || new Date(b.attempt.endedAt) - new Date(a.attempt.endedAt) || b.attemptId.localeCompare(a.attemptId));
    const s = group.source;
    const manual = !!s?.enabled && s.strategies.includes('manual_review');
    const placeholders = group.candidates.filter((c) => !c.evidence.length && !c.diffs.length);
    const meaningful = group.candidates.filter((c) => c.evidence.length || c.diffs.length);
    const fingerprints = new Map();
    for (const c of meaningful) {
      const fingerprint = normalizedFingerprint(c.normalized, c.evidence, c.diffs, c.sourceYear);
      if (!fingerprints.has(fingerprint)) fingerprints.set(fingerprint, []);
      fingerprints.get(fingerprint).push(c);
    }
    // An unverified current source remains verification work even when older
    // meaningful candidates exist. Never reclassify its static warning as a change.
    const latestIsPlaceholder = placeholders.some((c) => c.attemptId === latest?.id);
    if (manual || !fingerprints.size || latestIsPlaceholder) {
      entries.push({ kind: 'unverified_source', festivalSlug: token(festivalSlug), actionable: !!s?.enabled,
        source: sourceMetadata(s), latestAttempt: attemptMetadata(latest), candidate: null,
        placeholderCount: placeholders.length, suppressedCandidateCount: 0 });
    }
    if (!fingerprints.size) continue;
    for (const [fingerprint, repeats] of fingerprints) {
      const c = repeats[0]; // Newest representative of this meaningful content.
      const staleReasons = [];
      if (!latest || latest.id !== c.attemptId) staleReasons.push('newer_attempt');
      if (!s) staleReasons.push('source_missing_or_url_changed');
      else {
        if (!s.enabled) staleReasons.push('source_disabled');
        // A due scheduler acknowledgement updates both timestamps for this
        // attempt. It is not an operator configuration change; mismatched
        // timestamps still require fresh evidence.
        const acknowledgedThisAttempt = s.lastAttemptAt &&
          new Date(s.updatedAt).getTime() === new Date(s.lastAttemptAt).getTime() &&
          new Date(s.lastAttemptAt) >= new Date(c.attempt.endedAt) &&
          latest?.id === c.attemptId;
        if (new Date(s.updatedAt) > new Date(c.attempt.startedAt) && !acknowledgedThisAttempt)
          staleReasons.push('source_updated_after_attempt');
        if (c.sourceYear != null && c.sourceYear !== s.editionYear) staleReasons.push('edition_changed');
      }
      entries.push({ kind: 'review_candidate', festivalSlug: token(festivalSlug), actionable: !!s?.enabled && staleReasons.length === 0,
        source: sourceMetadata(s), latestAttempt: attemptMetadata(latest),
        candidate: { id: token(c.id), runId: token(c.runId), attemptId: token(c.attemptId), schemaVersion: c.schemaVersion, sourceYear: c.sourceYear, createdAt: iso(c.createdAt),
          attempt: attemptMetadata(c.attempt), normalizedFingerprint: fingerprint, fingerprintAlgorithm: 'sha256-meaningful-facts-evidence-v2', stale: staleReasons.length > 0, staleReasons,
          evidence: c.evidence.map((e) => ({ id: token(e.id), field: token(e.field), contentHash: hash(e.contentHash), adapter: token(e.adapter), observedAt: iso(e.observedAt), sourceUrl: safeUrl(e.sourceUrl) })),
          diffs: c.diffs.map(diffMetadata) },
        placeholderCount: placeholders.length, suppressedCandidateCount: repeats.length - 1 });
    }
  }
  if (entries.length > limit) fail('Queue exceeds limit; no queue exported');
  return { schemaVersion: 2, generatedAt: new Date().toISOString(), readOnly: true, complete: true, bounds: BOUNDS, limit, manualSourceCount: sources.filter((s) => s.enabled && s.strategies.includes('manual_review')).length, entries };
}

export async function runCli(args, env, { readHead, connect, output }) {
  let db;
  try {
    const options = parseArgs(args);
    guardHead(options.expectedHead, readHead);
    if (!env.DATABASE_URL?.trim()) fail('Requires DATABASE_URL');
    db = await connect(env.DATABASE_URL);
    const result = await db.$transaction(async (tx) => {
      // PostgreSQL enforces read-only, with a consistent snapshot for stale checks.
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return readReviewQueue(tx, options);
    }, { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 30000 });
    await db.$disconnect(); db = undefined;
    output(JSON.stringify({ ...result, expectedHead: options.expectedHead }) + '\n');
    return 0;
  } catch (error) {
    output(JSON.stringify({ error: error instanceof QueueError ? error.message : 'Review queue export failed' }) + '\n');
    return 1;
  } finally {
    if (db) { try { await db.$disconnect(); } catch { /* Never disclose driver diagnostics. */ } }
  }
}
