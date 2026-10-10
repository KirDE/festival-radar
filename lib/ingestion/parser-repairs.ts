import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { RefreshPolicy } from './types.ts';
import { validateSource } from '../sources/repository.ts';
import { fingerprint, ImportAgentError } from './agent-contract.ts';
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

// Corrections close their original ingestion issue. Activate a newly deployed
// registered adapter under the repair capability, without reopening that issue
// or touching catalogue facts, provider jobs, or source failure/backoff state.
export async function configureParserRepair(db: PrismaClient, input: {
  repairId: string; leaseToken: string; expectedParserKey: string; followLinkPattern: string | null;
}) {
  return db.$transaction(async tx => {
    const held = await tx.$queryRaw<{payload: Record<string, unknown>; active: boolean}[]>`SELECT payload,
      ("leaseOwner"=${input.leaseToken} AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) active
      FROM "OperationalState" WHERE key=${prefix+input.repairId} FOR UPDATE`;
    if (held.length !== 1) throw new ImportAgentError('missing');
    if (!held[0].active || held[0].payload.status === 'completed') throw new ImportAgentError('busy');
    const context = held[0].payload;
    if (typeof context.sourceId !== 'string') throw new ImportAgentError('invalid');
    const locked = await tx.$queryRaw<{id: string}[]>`SELECT id FROM "FestivalSource" WHERE id=${context.sourceId}
      AND ("leaseOwner" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) FOR UPDATE`;
    if (locked.length !== 1) throw new ImportAgentError('busy');
    const source = await tx.festivalSource.findUniqueOrThrow({where:{id:context.sourceId},include:{festival:true,edition:true}});
    if (!source.enabled || source.deprecatedAt || !source.festival || !source.edition || source.edition.recordState !== 'CURRENT'
      || source.festival.slug !== context.festivalSlug || source.festivalSlug !== context.festivalSlug
      || (source.fetchUrl ?? source.url) !== context.sourceUrl || source.editionYear !== context.year || source.edition.year !== context.year || source.edition.festivalId !== source.festivalId
      || context.parserKey !== input.expectedParserKey) throw new ImportAgentError('stale');
    let parserKey: string;
    try { parserKey = validateSource({festivalSlug:source.festivalSlug,url:source.url,editionYear:source.editionYear,
      enabled:source.enabled,refreshPolicy:source.refreshPolicy as RefreshPolicy,strategies:['official_markup'],
      ...(source.fetchUrl ? {fetchUrl:source.fetchUrl} : {}),...(input.followLinkPattern !== null ? {followLinkPattern:input.followLinkPattern} : {})}); }
    catch { throw new ImportAgentError('invalid'); }
    if (source.parserKey === parserKey && source.strategies.join('+') === 'official_markup' && source.followLinkPattern === input.followLinkPattern)
      return {configured:true,repairId:input.repairId,parserKey};
    if (source.parserKey !== input.expectedParserKey) throw new ImportAgentError('stale');
    await tx.festivalSource.update({where:{id:source.id},data:{strategies:['official_markup'],parserKey,
      followLinkPattern:input.followLinkPattern,manualReviewReason:null,configurationBackfilledAt:new Date(),httpEtag:null,httpLastModified:null}});
    await tx.adminAuditEntry.create({data:{actorLabel:'OpenClaw parser repair',action:'ingestion.parser.configured',resourceKind:'FESTIVAL',
      resourceKey:source.festivalSlug,beforeValue:{parserKey:source.parserKey,followLinkPattern:source.followLinkPattern},
      afterValue:{parserKey,followLinkPattern:input.followLinkPattern},metadata:{repairId:input.repairId,sourceId:source.id}}});
    return {configured:true,repairId:input.repairId,parserKey};
  },{isolationLevel:'Serializable',timeout:30000});
}
