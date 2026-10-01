import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { dueWorkerHealth } from '../lib/ingestion/due-health.ts';

const url = process.env.DATABASE_URL;
if (!url || !/(?:test|integration)/i.test(new URL(url).pathname)) throw new Error('Disposable test/integration DATABASE_URL required');
const db = new PrismaClient();
const slug = 'health-' + randomUUID().slice(0, 8);
test('disposable PostgreSQL reports due, active, expired, error and unknown parser counts without leaking keys', async () => {
  const now = new Date();
  const before = await dueWorkerHealth(db, now);
  let festival;
  try {
    festival = await db.festival.create({ data: {
      slug, name: 'Health Fixture', country: 'Test', countryCode: 'DE', officialUrl: 'https://example.test/health', genres: [],
      editions: { create: { year: 2027, status: 'TBA', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'TBA', sourceUpdatedAt: now } },
    } });
    const edition = await db.festivalEdition.findFirstOrThrow({ where: { festivalId: festival.id } });
    await db.festivalSource.createMany({ data: [
      { festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: 'https://example.test/one',
        strategies: ['manual_review'], parserKey: 'private-unexpected-key', refreshPolicy: 'daily', cadenceSeconds: 86400,
        enabled: true, editionYear: 2027, configurationBackfilledAt: now, nextRunAt: new Date(now.getTime() - 7200000), consecutiveFailures: 1 },
      { festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: 'https://example.test/two',
        strategies: ['manual_review'], parserKey: 'manual_review', refreshPolicy: 'daily', cadenceSeconds: 86400,
        enabled: true, editionYear: 2027, configurationBackfilledAt: now, nextRunAt: new Date(now.getTime() - 7200000),
        leaseOwner: randomUUID(), leaseExpiresAt: new Date(now.getTime() + 60000) },
      { festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: 'https://example.test/three',
        strategies: ['manual_review'], parserKey: 'manual_review', refreshPolicy: 'daily', cadenceSeconds: 86400,
        enabled: true, editionYear: 2027, configurationBackfilledAt: now, nextRunAt: new Date(now.getTime() - 7200000),
        leaseOwner: randomUUID(), leaseExpiresAt: new Date(now.getTime() - 60000) },
      { festivalSlug: slug, festivalId: festival.id, editionId: edition.id, url: 'https://example.test/four',
        strategies: ['json_ld_event'], parserKey: 'manual_review', refreshPolicy: 'daily', cadenceSeconds: 86400,
        enabled: true, editionYear: 2027, configurationBackfilledAt: now, nextRunAt: new Date(now.getTime() + 7200000) },
    ] });
    const after = await dueWorkerHealth(db, now);
    assert.equal(after.due - before.due, 2);
    assert.equal(after.queueLaggedOverHour - before.queueLaggedOverHour, 2);
    assert.equal(after.active - before.active, 1);
    assert.equal(after.expired - before.expired, 1);
    assert.equal(after.error - before.error, 1);
    assert.equal(after.unknownParserKeys - before.unknownParserKeys, 2);
    assert.equal(after.outboxPending - before.outboxPending, 0);
    assert.equal(after.outboxLaggedOverHour - before.outboxLaggedOverHour, 0);
    assert.doesNotMatch(JSON.stringify(after), /private-unexpected-key/);
  } finally {
    if (festival) {
      await db.festivalSource.deleteMany({ where: { festivalSlug: slug } });
      await db.festival.delete({ where: { id: festival.id } });
    }
    await db.$disconnect();
  }
});
