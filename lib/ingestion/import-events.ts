import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { inspectSource } from './agent-issues.ts';
import { fingerprint } from './agent-contract.ts';
import type { ImportEvent } from './import-event-queue.ts';
export type DispatchEvent = { eventId: string; kind: 'source'; sourceId: string; issueId: string } | { eventId: string; kind: 'repair'; repairId: string };

export async function prepareImportEvent(db: PrismaClient, event: ImportEvent, now = new Date()): Promise<{ event?: DispatchEvent; defer?: Date }> {
  if (event.kind === 'repair') {
    const row = await db.operationalState.findUnique({ where: { key: 'parser-repair-' + event.repairId } });
    const p = row?.payload as any;
    if (!p || p.status === 'completed') return {};
    if (row!.leaseExpiresAt && row!.leaseExpiresAt > now) return { defer: row!.leaseExpiresAt };
    if (p.retryAt && new Date(p.retryAt) > now) return { defer: new Date(p.retryAt) };
    return { event: { kind: 'repair', repairId: event.repairId, eventId: fingerprint({ repairId: event.repairId, retryAt: p.retryAt ?? null }) } };
  }
  const issue = await inspectSource(db, event.sourceId);
  if (!issue || !issue.attempt || issue.attempt.id !== event.attemptId) return {};
  const source = await db.festivalSource.findUniqueOrThrow({ where: { id: event.sourceId } });
  if (source.leaseExpiresAt && source.leaseExpiresAt > now) return { defer: source.leaseExpiresAt };
  const state = await db.operationalState.findUnique({ where: { key: issue.key } });
  const p = (state?.payload ?? {}) as any;
  if (p.status === 'needs_user' || p.status === 'resolved') return {};
  if (state?.leaseExpiresAt && state.leaseExpiresAt > now) return { defer: state.leaseExpiresAt };
  if (p.retryAt && new Date(p.retryAt) > now) return { defer: new Date(p.retryAt) };
  if (issue.kind === 'failure' && p.attempts > 0 && source.nextRunAt && source.nextRunAt > now) return { defer: source.nextRunAt };
  return { event: { kind: 'source', sourceId: source.id, issueId: issue.issueId,
    eventId: fingerprint({ issueId: issue.issueId, episode: issue.kind === 'failure' ? source.lastSuccessAt : null, retryAt: p.retryAt ?? null }) } };
}

export async function verifyDispatchEvent(db: PrismaClient, event: DispatchEvent) {
  const input: ImportEvent = event.kind === 'repair' ? event : {
    kind: 'source', sourceId: event.sourceId,
    attemptId: (await inspectSource(db, event.sourceId))?.attempt?.id ?? '',
  };
  const current = await prepareImportEvent(db, input);
  return { ready: Boolean(current.event && fingerprint(current.event) === fingerprint(event)), obsolete: (!current.defer && !current.event) || Boolean(current.event && fingerprint(current.event) !== fingerprint(event)) };
}

export async function drainImportEvents(db: PrismaClient, send: (event: DispatchEvent) => Promise<void>, limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('Invalid import event batch');
  let delivered = 0, failed = 0;
  const deadline = Date.now() + 60_000;
  for (let n = 0; n < limit && Date.now() < deadline; n++) {
    const owner = randomUUID();
    const rows = await db.$queryRaw<Array<{key: string; payload: any}>>`
      UPDATE "OperationalState" SET "leaseOwner"=${owner}, "leaseExpiresAt"=timezone('UTC',clock_timestamp())+interval '2 minutes'
      WHERE key=(SELECT key FROM "OperationalState" WHERE key LIKE 'import-event-%'
        AND payload->>'status'='pending' AND (payload->>'notBefore')::timestamptz<=clock_timestamp()
        AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt"<=timezone('UTC',clock_timestamp()))
        ORDER BY "updatedAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING key,payload`;
    if (!rows.length) break;
    const row = rows[0];
    let payload = row.payload;
    try {
      const prepared = await prepareImportEvent(db, payload);
      if (prepared.defer) payload = { ...payload, notBefore: prepared.defer.toISOString() };
      else {
        if (prepared.event) {
          const receiptKey = 'import-dispatch-' + prepared.event.eventId;
          const receipt = await db.operationalState.findUnique({ where: { key: receiptKey } });
          if (!receipt) {
            await send(prepared.event);
            await db.operationalState.upsert({ where: { key: receiptKey }, create: { key: receiptKey, payload: { acceptedAt: new Date().toISOString() } }, update: {} });
            delivered++;
          }
        }
        payload = { ...payload, status: 'done' };
      }
    } catch {
      // Transport/database/receiver failure is not a reason to spend model tokens.
      failed++;
      payload = { ...payload, notBefore: new Date(Date.now() + 15 * 60_000).toISOString() };
    }
    await db.operationalState.updateMany({ where: { key: row.key, leaseOwner: owner }, data: {
      payload: payload as Prisma.InputJsonValue, leaseOwner: null, leaseExpiresAt: null,
    } });
  }
  return { delivered, failed };
}
