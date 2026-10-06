import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { validateFestivalTimetable } from '../timetables.ts';
import type { Festival, TimetableEntry } from '../domain/festival.ts';

export async function importTimetable(db: PrismaClient, input: { festivalSlug: string; editionYear: number; entries: TimetableEntry[] }, checkOnly = true) {
  if (!Number.isInteger(input.editionYear)) throw new Error('An explicit editionYear is required');
  return db.$transaction(async tx => {
    const edition = await tx.festivalEdition.findFirstOrThrow({ where: { festival: { slug: input.festivalSlug }, year: input.editionYear }, include: { festival: true, timetable: true } });
    await tx.$queryRaw`SELECT id FROM "FestivalEdition" WHERE id = ${edition.id} FOR UPDATE`;
    // Re-read after the lock to detect concurrent timetable or catalogue edits.
    const current = await tx.festivalEdition.findUniqueOrThrow({ where: { id: edition.id }, include: { festival: true, timetable: true } });
    const festival = { officialUrl: current.festival.officialUrl, startDate: current.startDate?.toISOString().slice(0, 10), endDate: current.endDate?.toISOString().slice(0, 10) } as Festival;
    const entries = validateFestivalTimetable(festival, input.entries);
    if (!entries.length) throw new Error('Empty timetable requires separate removal review');
    if (new Set(entries.map(entry => entry.timeZone)).size !== 1) throw new Error('A timetable must use one IANA timezone');
    const normalize = (items: TimetableEntry[]) => items.map(item => [item.date, item.stage, item.start, item.artist, item.timeZone, item.status, item.sourceUrl, new Date(item.observedAt!).toISOString()]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const before = normalize(current.timetable.map(row => ({ date: row.date.toISOString().slice(0, 10), stage: row.stage, start: row.start, artist: row.artistName, timeZone: row.timeZone ?? 'UTC', status: row.status === 'CANCELLED' ? 'cancelled' : 'scheduled', sourceUrl: row.sourceUrl ?? current.festival.officialUrl, observedAt: (row.observedAt ?? current.sourceUpdatedAt).toISOString() })));
    const after = normalize(entries);
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const changed = hash(before) !== hash(after);
    if (!checkOnly && changed) {
      await tx.timetablePerformance.deleteMany({ where: { editionId: current.id } });
      await tx.timetablePerformance.createMany({ data: entries.map(entry => ({ editionId: current.id, artistName: entry.artist, date: new Date(entry.date + 'T00:00:00Z'), stage: entry.stage, start: entry.start, timeZone: entry.timeZone, status: entry.status === 'cancelled' ? 'CANCELLED' : 'ANNOUNCED', sourceUrl: entry.sourceUrl, observedAt: new Date(entry.observedAt!) })) });
    }
    return { checkOnly, changed: changed ? 1 : 0, beforeCount: before.length, afterCount: after.length, beforeHash: hash(before), afterHash: hash(after) };
  }, { isolationLevel: 'Serializable' });
}
