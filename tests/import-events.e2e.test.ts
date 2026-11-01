import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../lib/db.ts';
import { seedCatalog } from './support/seed-catalog.ts';
import { catalogSeed } from './support/catalog.ts';
import { requireLocalDisposableDatabase } from './support/disposable-db.ts';
import { persistAttempt, createIngestionRun } from '../lib/ingestion/repository.ts';
import { drainImportEvents, prepareImportEvent, verifyDispatchEvent } from '../lib/ingestion/import-events.ts';
import { enqueueParserRepair } from '../lib/ingestion/parser-repairs.ts';
import {extractFestivalCandidate} from '../lib/ingestion/extract.ts';
import {evaluateCandidate} from '../lib/ingestion/policy.ts';
requireLocalDisposableDatabase(process.env.DATABASE_URL);
let sourceId: string, runId: string, url: string;
test.beforeEach(async () => {
  await db.operationalState.deleteMany();
  await db.festivalSource.deleteMany({ where: { festivalSlug: 'synthetic-fest' } });
  await seedCatalog(db, catalogSeed);
  const festival = await db.festival.findUniqueOrThrow({ where: { slug: 'synthetic-fest' } });
  const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id, recordState: 'CURRENT' } });
  url = 'https://festival.example.test/' + randomUUID();
  const source = await db.festivalSource.create({ data: { festivalSlug: festival.slug, festivalId: festival.id, editionId: edition.id,
    editionYear: edition.year, url, strategies: ['json_ld_event'], parserKey: 'json_ld_event', refreshPolicy: 'weekly', cadenceSeconds: 604800,
    configurationBackfilledAt: new Date(Date.now() - 10000), enabled: true } });
  sourceId = source.id;
  runId = (await createIngestionRun(db, { trigger: 'TEST', sourceCommit: 'event-test', totalSources: 1 })).id;
});
test.after(async () => { await db.festivalSource.deleteMany({ where: { festivalSlug: 'synthetic-fest' } }); await db.operationalState.deleteMany(); await db.$disconnect(); });
async function fail() {
  return persistAttempt(db, { runId, festivalSlug: 'synthetic-fest', requestedUrl: url, httpStatus: 200, durationMs: 1,
    startedAt: new Date(), endedAt: new Date(), error: 'parser_error' });
}
test('actual failed attempt atomically requests repair; delivery is once per issue, not per check', async () => {
  await fail();
  assert.equal(await db.operationalState.count({ where: { key: { startsWith: 'import-event-' } } }), 1);
  const sent: any[] = [];
  assert.deepEqual(await drainImportEvents(db, async e => { sent.push(e); }), { delivered: 1, failed: 0 });
  assert.equal(sent[0].kind, 'source'); assert.equal(sent[0].sourceId, sourceId);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['eventId', 'issueId', 'kind', 'sourceId']);
  assert.deepEqual(await verifyDispatchEvent(db, sent[0]), { ready: true, obsolete: false });
  await fail();
  await drainImportEvents(db, async e => { sent.push(e); });
  assert.equal(sent.length, 1);
});
test('transport outage retains durable pending request and does not change source/candidate state', async () => {
  await fail();
  const before = await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } });
  assert.deepEqual(await drainImportEvents(db, async () => { throw new Error('offline'); }), { delivered: 0, failed: 1 });
  const row = await db.operationalState.findFirstOrThrow({ where: { key: { startsWith: 'import-event-' } } });
  assert.equal((row.payload as any).status, 'pending'); assert.equal(row.leaseOwner, null);
  assert.ok(new Date((row.payload as any).notBefore) > new Date());
  assert.deepEqual(await db.festivalSource.findUniqueOrThrow({ where: { id: sourceId } }), before);
  await db.operationalState.update({ where: { key: row.key }, data: { payload: { ...(row.payload as any), notBefore: new Date(0).toISOString() } } });
  assert.equal((await drainImportEvents(db, async () => {})).delivered, 1);
});
test('active importer lease defers without a model; stale and resolved cases are dropped', async () => {
  const a = await fail();
  await db.festivalSource.update({ where: { id: sourceId }, data: { leaseOwner: 'worker', leaseExpiresAt: new Date(Date.now() + 60000) } });
  let calls = 0;
  assert.equal((await drainImportEvents(db, async () => { calls++; })).delivered, 0); assert.equal(calls, 0);
  const result = await prepareImportEvent(db, { kind: 'source', sourceId, attemptId: a.id }); assert.ok(result.defer);
  await db.festivalSource.update({ where: { id: sourceId }, data: { leaseOwner: null, leaseExpiresAt: null } });
  const ready = await prepareImportEvent(db, { kind: 'source', sourceId, attemptId: a.id }); assert.ok(ready.event);
  if (ready.event?.kind !== 'source') throw new Error();
  await db.operationalState.create({ data: { key: 'ingestion-agent-' + ready.event.issueId, payload: { status: 'resolved' } } });
  assert.deepEqual(await verifyDispatchEvent(db, ready.event), { ready: false, obsolete: true });
});
test('repair creation is transactional, deduplicated and completion never wakes a model', async () => {
  const context = { sourceId, issueId: 'c'.repeat(64), festivalSlug: 'synthetic-fest' };
  await assert.rejects(db.$transaction(async tx => { await enqueueParserRepair(tx, context); throw new Error('rollback'); }));
  assert.equal(await db.operationalState.count(), 0);
  const id = await db.$transaction(tx => enqueueParserRepair(tx, context));
  await db.$transaction(tx => enqueueParserRepair(tx, context));
  const sent: any[] = [];
  assert.equal((await drainImportEvents(db, async e => { sent.push(e); })).delivered, 1);
  assert.equal(sent[0].repairId, id);
  await db.operationalState.update({ where: { key: 'parser-repair-' + id }, data: { payload: { status: 'completed' } } });
  assert.deepEqual(await verifyDispatchEvent(db, sent[0]), { ready: false, obsolete: true });
});
test('empty/healthy idle importer and missing attempts do not dispatch', async () => {
  assert.deepEqual(await drainImportEvents(db, async () => { throw new Error('must not send'); }), { delivered: 0, failed: 0 });
});
test('a real extraction coverage gap commits one actionable event; repeated daily observations do not call the model again',async()=>{
  const beforeJobs=await db.catalogPlaylistRefresh.count();
  const observe=async(title:string)=>{
    const fetchedAt=new Date().toISOString();
    const candidate=extractFestivalCandidate(`<main><h2>${title}</h2></main>`,{festivalSlug:'synthetic-fest',url,editionYear:2027,strategies:['json_ld_event'],enabled:true,refreshPolicy:'daily'},fetchedAt);
    const result=evaluateCandidate({slug:'synthetic-fest',editionYear:2027,headliners:[],lineup:[],status:'tba'} as any,candidate);
    assert.ok(result.reviewReasons.some(x=>x.includes('announcement:')));
    assert.equal(result.changes.length,0);assert.equal(result.publishable,false);
    return persistAttempt(db,{runId,festivalSlug:'synthetic-fest',requestedUrl:url,httpStatus:200,durationMs:1,startedAt:new Date(),endedAt:new Date(),result});
  };
  const sent:any[]=[];
  await observe('First names for 2027 announced!');
  assert.equal((await drainImportEvents(db,async event=>{sent.push(event);})).delivered,1);
  assert.deepEqual(Object.keys(sent[0]).sort(),['eventId','issueId','kind','sourceId']);
  await observe('First names for 2027 announced!');
  assert.equal((await drainImportEvents(db,async event=>{sent.push(event);})).delivered,0);assert.equal(sent.length,1);
  await observe('More names for 2027 announced!');
  assert.equal((await drainImportEvents(db,async event=>{sent.push(event);})).delivered,1);assert.equal(sent.length,2);
  assert.equal(await db.catalogPlaylistRefresh.count(),beforeJobs);
});
test('successful recognized empty manual result stays silent end-to-end', async () => {
  await db.festivalSource.update({ where: { id: sourceId }, data: { strategies: ['manual_review'], parserKey: 'manual_review' } });
  const fetchedAt = new Date().toISOString();
  await persistAttempt(db, { runId, festivalSlug: 'synthetic-fest', requestedUrl: url, httpStatus: 200, durationMs: 1,
    startedAt: new Date(), endedAt: new Date(), result: { schemaVersion: 1, festivalSlug: 'synthetic-fest', sourceUrl: url, fetchedAt,
      publishable: false, reviewReasons: [], changes: [], candidate: { schemaVersion: 1, festivalSlug: 'synthetic-fest', sourceUrl: url, fetchedAt,
        warnings: [], evidence: [], observedEditionYears: [] } } });
  assert.deepEqual(await drainImportEvents(db, async () => { throw new Error('must not send'); }), { delivered: 0, failed: 0 });
  const row = await db.operationalState.findFirstOrThrow({ where: { key: { startsWith: 'import-event-' } } });
  assert.equal((row.payload as any).status, 'done');
});
test('separate failure episode after recovery is not suppressed by old receipt', async () => {
  await fail();
  const sent: any[] = [];
  await drainImportEvents(db, async e => { sent.push(e); });
  await db.festivalSource.update({ where: { id: sourceId }, data: { lastSuccessAt: new Date() } });
  await fail();
  await drainImportEvents(db, async e => { sent.push(e); });
  assert.equal(sent.length, 2); assert.notEqual(sent[0].eventId, sent[1].eventId);
});
