import assert from 'node:assert/strict';
import test from 'node:test';
import {spotifyRepertoireSchema, spotifyRepertoiresForArtists, REPERTOIRE_PROFILE_PREFIX as P, REPERTOIRE_BINDING_PREFIX as B} from '../lib/catalog/spotify-repertoire.ts';

export const profile = {schemaVersion: 1, key: 'joint-act:v1', artistSlugs: ['joint-act'], setlistArtist: 'Anchor',
  searchArtists: [{id: 'a'.repeat(22), name: 'Anchor'}, {id: 'b'.repeat(22), name: 'Singer'}, {id: 'c'.repeat(22), name: 'Singer & Band'}],
  anchorArtistIds: ['a'.repeat(22)], collaborationArtistIds: ['b'.repeat(22), 'c'.repeat(22)], albumIds: ['d'.repeat(22)],
  sourceUrls: ['https://open.spotify.com/album/' + 'd'.repeat(22)]};

test('one live act may have N reviewed search identities, not equivalent identity aliases', () => {
  assert.equal(spotifyRepertoireSchema.parse(profile).searchArtists.length, 3);
  assert.equal(spotifyRepertoireSchema.parse({...profile,
    searchArtists: [...profile.searchArtists, {id: 'e'.repeat(22), name: 'Band'}],
    collaborationArtistIds: [...profile.collaborationArtistIds, 'e'.repeat(22)],
  }).searchArtists.length, 4);
  assert.throws(() => spotifyRepertoireSchema.parse({...profile, anchorArtistIds: ['b'.repeat(22)]}));
  assert.throws(() => spotifyRepertoireSchema.parse({...profile, searchArtists: [profile.searchArtists[0], profile.searchArtists[0]]}));
  assert.throws(() => spotifyRepertoireSchema.parse({...profile, albumIds: []}));
});

function fixture(rows) {
  const requests = [];
  return {requests, db: {operationalState: {findMany: async ({where}) => {
    requests.push(where.key.in); return rows.filter(row => where.key.in.includes(row.key));
  }}}};
}

test('worker transport reads only bindings for actual lineup artists; unrelated profiles remain untouched', async () => {
  const f = fixture([{key: B + 'joint-act', payload: {profileKey: profile.key}}, {key: P + profile.key, payload: profile},
    {key: B + 'unrelated', payload: {invalid: true}}, {key: P + 'unrelated', payload: {invalid: true}}]);
  const result = await spotifyRepertoiresForArtists(f.db, [{slug: 'joint-act', name: 'One live act'}, {slug: 'solo', name: 'Solo'}]);
  assert.deepEqual(Object.keys(result), ['One live act']);
  assert.deepEqual(result['One live act'], profile);
  assert.deepEqual(f.requests, [[B + 'joint-act', B + 'solo'], [P + profile.key]]);
});

test('normal unprofiled artists preserve the old worker path', async () => {
  const f = fixture([]);
  assert.deepEqual(await spotifyRepertoiresForArtists(f.db, [{slug: 'solo', name: 'Solo'}]), {});
  assert.equal(f.requests.length, 1);
  assert.deepEqual(await spotifyRepertoiresForArtists(f.db, []), {});
  assert.equal(f.requests.length, 1);
});

test('missing, invalid and wrongly assigned profiles fail closed instead of fuzzy catalog fallback', async () => {
  for (const rows of [
    [{key: B + 'joint-act', payload: {profileKey: profile.key}}],
    [{key: B + 'joint-act', payload: {profileKey: profile.key}}, {key: P + profile.key, payload: {...profile, artistSlugs: ['other']}}],
    [{key: B + 'joint-act', payload: {profileKey: profile.key}}, {key: P + profile.key, payload: {...profile, key: 'wrong-key'}}],
    [{key: B + 'joint-act', payload: {profileKey: profile.key}}, {key: P + profile.key, payload: {...profile, albumIds: []}}],
  ]) await assert.rejects(spotifyRepertoiresForArtists(fixture(rows).db, [{slug: 'joint-act', name: 'Joint'}]));
});
