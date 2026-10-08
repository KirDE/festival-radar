import assert from 'node:assert/strict';
import test from 'node:test';
import { sortFestivalLineup } from '../lib/festival-lineup.ts';
import type { TimetableEntry } from '../lib/domain/festival.ts';

const scheduled = (artist: string, date: string, start: string, status: 'scheduled' | 'cancelled' = 'scheduled'): TimetableEntry =>
  ({ artist, date, start, status, stage: 'Stage', timeZone: 'Europe/Berlin', sourceUrl: 'https://example.test', observedAt: date });

test('official order is default data order and sorts never mutate it or include headliners', () => {
  const item = { lineup: ['Z', 'A', 'B'], headliners: ['Headliner'] };
  for (const sort of ['official', 'alphabetical', 'chronological', 'popularity'] as const) {
    assert.equal(sortFestivalLineup(item, sort, 'en').includes('Headliner'), false);
  }
  assert.deepEqual(sortFestivalLineup(item, 'official', 'en'), ['Z', 'A', 'B']);
  assert.deepEqual(item.lineup, ['Z', 'A', 'B']);
});
test('alphabetical order uses the active locale and equal collation preserves official positions', () => {
  const item = { lineup: ['b', 'ä', 'A', 'a', 'Б', 'А'] };
  for (const locale of ['en', 'de', 'ru']) {
    const expected = [...item.lineup].sort(new Intl.Collator(locale, { sensitivity: 'base' }).compare);
    assert.deepEqual(sortFestivalLineup(item, 'alphabetical', locale), expected);
  }
  assert.deepEqual(sortFestivalLineup({ lineup: ['a', 'A', 'ä'] }, 'alphabetical', 'de'), ['a', 'A', 'ä']);
});
test('chronological chooses first scheduled date/start, ignores cancellations and unknown times, ties stay official', () => {
  const item = { lineup: ['Unknown', 'Late', 'Tie B', 'Tie A', 'Early', 'Cancelled', 'No time'], timetable: [
    scheduled('Late', '2027-06-02', '09:00'), scheduled('Early', '2027-06-01', '23:00'),
    scheduled('Tie A', '2027-06-01', '12:00'), scheduled('Tie B', '2027-06-01', '12:00'),
    scheduled('Early', '2027-06-01', '10:00'), scheduled('Cancelled', '2027-05-01', '10:00', 'cancelled'),
    scheduled('No time', '2027-05-01', 'TBA'), scheduled('Unknown', '', '10:00'),
  ] };
  assert.deepEqual(sortFestivalLineup(item, 'chronological', 'en'), ['Early', 'Tie B', 'Tie A', 'Late', 'Unknown', 'Cancelled', 'No time']);
});
test('popularity descending keeps real zero before unknown and preserves ties and unknown order', () => {
  const item = { lineup: ['Missing', 'Zero', 'Tie B', 'Invalid', 'Top', 'Tie A', 'Null', 'NaN'] };
  assert.deepEqual(sortFestivalLineup(item, 'popularity', 'en', { Zero: 0, 'Tie B': 50, 'Tie A': 50, Top: 100, Null: null, Invalid: 101, NaN: NaN }),
    ['Top', 'Tie B', 'Tie A', 'Zero', 'Missing', 'Invalid', 'Null', 'NaN']);
});
