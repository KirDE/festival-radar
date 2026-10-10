import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { fingerprint, ImportAgentError, decisionSchema } from './agent-contract.ts';
import { mapSource, validateSource } from '../sources/repository.ts';
const prefix = 'parser-repair-';
type Database = PrismaClient | Prisma.TransactionClient;

export async function enqueueParserRepair(db: Database, context: Record<string, unknown>) {
  const id = fingerprint({ sourceId: context.sourceId, issueId: context.issueId });
  await db.operationalState.upsert({ where: { key: prefix + id },
    create: { key: prefix + id, payload: { ...context, repairId: id, status: 'pending', requestedAt: new Date().toISOString() } as Prisma.InputJsonValue }, update: {} });
  return id;
}
export async function listParserRepairs(db: Database, now = new Date()) {
  const rows = await db.operationalState.findMany({ where: { key: { startsWith: prefix }, NOT: { payload: { path: ['status'], equals: 'completed' } } }, orderBy: { updatedAt: 'asc' }, take: 1001 });
  if (rows.length > 1000) throw new ImportAgentError('invalid');
  const ready = rows.filter(row => {
    const p = row.payload as any;
    return p.status !== 'completed' && (!p.retryAt || new Date(p.retryAt) <= now)
      && (!row.leaseOwner || !row.leaseExpiresAt || row.leaseExpiresAt <= now);
  });
  return { complete: true, ready: ready.length, total: rows.length,
    revision: fingerprint(ready.map(r => [r.key, r.updatedAt])),
    issues: ready.slice(0, 10).map(r => { const { leaseDigest: _d, ...p } = r.payload as any; return p; }) };
}
export async function claimParserRepair(db: PrismaClient, id: string) {
  const token = randomUUID();
  const rows = await db.$queryRaw<{ payload: Record<string, unknown> }[]>`UPDATE "OperationalState" SET "leaseOwner"=${token},
    "leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours', "updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    WHERE key=${prefix+id} AND payload->>'status' <> 'completed'
    AND (payload->>'retryAt' IS NULL OR (payload->>'retryAt')::timestamptz <= clock_timestamp())
    AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) RETURNING payload`;
  if (rows.length !== 1) throw new ImportAgentError('busy');
  return { ...rows[0].payload, repairId: id, leaseToken: token };
}
export async function finishParserRepair(db: PrismaClient, id: string, token: string, result: {
  status: 'completed' | 'retry'; reason: string; prUrl?: string; commit?: string;
}) {
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ payload: Record<string, unknown>; active: boolean }[]>`SELECT payload,
      ("leaseOwner"=${token} AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) active FROM "OperationalState" WHERE key=${prefix+id} FOR UPDATE`;
    if (rows.length !== 1) throw new ImportAgentError('missing');
    const old = rows[0].payload;
    const hash = fingerprint(result);
    if (old.leaseDigest === fingerprint(token) && old.resultHash === hash) return { status: old.status, repairId: id };
    if (!rows[0].active) throw new ImportAgentError('busy');
    if (result.status === 'completed' && (!result.prUrl || !result.commit)) throw new ImportAgentError('invalid');
    const payload = { ...old, ...result, resultHash: hash, leaseDigest: fingerprint(token),
      finishedAt: new Date().toISOString(), retryAt: result.status === 'retry' ? new Date(Date.now()+3600000).toISOString() : null };
    await tx.operationalState.update({ where: { key: prefix+id }, data: { payload: payload as Prisma.InputJsonValue, leaseOwner: null, leaseExpiresAt: null } });
    await tx.adminAuditEntry.create({ data: { actorLabel: 'OpenClaw parser repair', action: 'ingestion.parser.'+result.status,
      resourceKind: 'FESTIVAL', resourceKey: String(old.festivalSlug), afterValue: result } });
    return { status: result.status, repairId: id };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}

// A resolved correction no longer has an agent issue to claim. Configure only
// its repair-owned source, through the same protected capability transport.
export async function configureParserRepairSource(db: PrismaClient, id: string, token: string, decision: unknown, commit: string) {
  const d = decisionSchema.parse(decision);
  if (d.action !== 'apply' || !d.source || d.facts || d.source.strategies.includes('manual_review') ||
      !/^[a-f0-9]{40}$/.test(commit) || process.env.DEPLOYED_COMMIT !== commit) throw new ImportAgentError('invalid');
  const targetSource = d.source;
  return db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ payload: Record<string, unknown>; active: boolean }[]>`SELECT payload,
      ("leaseOwner"=${token} AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) active
      FROM "OperationalState" WHERE key=${prefix+id} FOR UPDATE`;
    if (rows.length !== 1 || !rows[0].active) throw new ImportAgentError('busy');
    const p = rows[0].payload;
    const sourceId = String(p.sourceId);
    await tx.$queryRaw`SELECT id FROM "FestivalSource" WHERE id=${sourceId} FOR UPDATE`;
    const s = await tx.festivalSource.findUnique({ where: { id: sourceId }, include: { edition: { select: { festivalId: true, year: true, recordState: true } } } });
    if (!s || !s.enabled || s.festivalSlug !== p.festivalSlug || s.editionYear !== p.year || s.edition?.recordState !== 'CURRENT') throw new ImportAgentError('stale');
    mapSource(s);
    if (s.leaseOwner && s.leaseExpiresAt && s.leaseExpiresAt > new Date()) throw new ImportAgentError('busy');
    // Never use a repair to bypass an inaccessible source's persisted backoff.
    if (s.consecutiveFailures || s.deprecatedAt) throw new ImportAgentError('busy');
    const official = new URL(s.url), target = new URL(targetSource.url);
    const host = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, '');
    if (target.protocol !== 'https:' || target.username || target.password || target.port || host(target) !== host(official) ||
        !d.evidence.some(e => e.field === 'source' && e.url === targetSource.url) ||
        d.evidence.some(e => { const u = new URL(e.url); return u.protocol !== 'https:' || u.username || u.password || u.port || host(u) !== host(official); })) throw new ImportAgentError('invalid');
    const configured = { ...mapSource(s), ...targetSource, fetchUrl: undefined, followLinkPattern: undefined, headers: undefined };
    const parserKey = validateSource({ ...configured, parserKey: undefined });
    const already = s.url === targetSource.url && s.parserKey === parserKey && s.refreshPolicy === targetSource.refreshPolicy && !s.fetchUrl && !s.followLinkPattern && !s.requestHeaders;
    if (already) return { configured: true, sourceId, parserKey, providerJobs: 0 };
    if (s.parserKey !== p.parserKey || (s.fetchUrl ?? s.url) !== p.sourceUrl) throw new ImportAgentError('stale');
    const now = new Date();
    const after = await tx.festivalSource.update({ where: { id: s.id }, data: {
      ...targetSource, parserKey, manualReviewReason: null, fetchUrl: null, followLinkPattern: null, requestHeaders: Prisma.DbNull,
      cadenceSeconds: { daily: 86400, every_3_days: 259200, weekly: 604800 }[targetSource.refreshPolicy],
      configurationBackfilledAt: now, nextRunAt: now, httpEtag: null, httpLastModified: null,
    }, include: { edition: { select: { festivalId: true, year: true } } } });
    mapSource(after);
    await tx.adminAuditEntry.create({ data: { actorLabel: 'OpenClaw parser repair', action: 'ingestion.parser.source_configured',
      resourceKind: 'FESTIVAL', resourceKey: s.festivalSlug,
      beforeValue: { url: s.url, parserKey: s.parserKey, refreshPolicy: s.refreshPolicy },
      afterValue: { url: after.url, parserKey: after.parserKey, refreshPolicy: after.refreshPolicy },
      evidence: d.evidence, metadata: { repairId: id, commit, providerJobs: 0, reason: d.reason } } });
    return { configured: true, sourceId, parserKey, providerJobs: 0 };
  }, { isolationLevel: 'Serializable', timeout: 30000 });
}
