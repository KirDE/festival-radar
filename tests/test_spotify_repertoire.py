import copy
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'))
from spotify_repertoire import validate_profile, eligible_track, select_tracks

PROFILE = {'schemaVersion': 1, 'key': 'joint-act:v1', 'artistSlugs': ['joint-act'], 'setlistArtist': 'Anchor',
           'searchArtists': [{'id': c * 22, 'name': n} for c, n in [('a', 'Anchor'), ('b', 'Singer'), ('c', 'Singer & Band')]],
           'anchorArtistIds': ['a' * 22], 'collaborationArtistIds': ['b' * 22, 'c' * 22], 'albumIds': ['d' * 22],
           'sourceUrls': ['https://open.spotify.com/album/' + 'd' * 22]}


def track(index, name=None, credits='a', album='d', popularity=50):
    ident = str(index).zfill(22)
    return {'id': ident, 'uri': 'spotify:track:' + ident, 'name': name or 'Song ' + str(index),
            'artists': [{'id': c * 22, 'name': {'a': 'Anchor', 'b': 'Singer', 'c': 'Singer & Band'}.get(c, 'Unrelated')} for c in credits],
            'album': {'id': album * 22}, 'duration_ms': 180000, 'popularity': popularity}


class RepertoireTests(unittest.TestCase):
    def test_actual_slash_credits_with_solo_split_and_combined_identities(self):
        raw = json.loads((Path(__file__).parent / 'fixtures/spotify-repertoire/slash-credits-20261029.json').read_text())
        profile = validate_profile(raw['profile'])
        self.assertEqual(len(profile['searchArtists']), 4)
        by_id = {t['id']: t for t in raw['tracks']}
        for ident in ['50XuBmcV8THyLBczxD0c2k', '6lvQzrVGg9i8vzz71WWSF2', '3jaJeSphs7bS5Gt3i5LJL3']:
            item = by_id[ident]
            album_id = item.get('albumId')
            if not album_id:
                album_id = {'World on Fire': '0HBgPC1vbZUmQziDZS78Rg'}.get(item.get('album'))
            actual = {**item, 'album': {'id': album_id}}
            self.assertTrue(eligible_track(profile, actual))

    def select(self, tracks, songs=None, seen_uris=None, seen_songs=None):
        calls = []
        def get(url, params):
            calls.append((url, params))
            if url.endswith('/top-tracks'): return {'tracks': tracks}
            if '/albums/' in url: return {'items': [{'id': t['id']} for t in tracks], 'next': None}
            if url.endswith('/tracks'): return {'tracks': [next(t for t in tracks if t['id'] == ident) for ident in params['ids'].split(',')]}
            if url.endswith('/search'): return {'tracks': {'items': []}}
            raise AssertionError(url)
        result = select_tracks(PROFILE, songs or {}, get, lambda s: s.lower().removesuffix(' - live'),
                               lambda t: t['duration_ms'] < 90000, lambda t: 1 if 'Live' in t['name'] else 0,
                               seen_uris if seen_uris is not None else set(), seen_songs if seen_songs is not None else set())
        return result, calls

    def test_variable_one_two_and_three_credits_are_supported(self):
        for item in [track(1), track(2, credits='ab', album='z'), track(3, credits='abc', album='z')]:
            self.assertTrue(eligible_track(PROFILE, item))
        self.assertFalse(eligible_track(PROFILE, track(4, credits='b')))
        self.assertFalse(eligible_track(PROFILE, track(5, credits='a', album='z')))
        self.assertFalse(eligible_track(PROFILE, track(6, credits='x')))
        fourth = {**PROFILE, 'searchArtists': PROFILE['searchArtists'] + [{'id': 'e' * 22, 'name': 'Band'}],
                  'collaborationArtistIds': PROFILE['collaborationArtistIds'] + ['e' * 22]}
        validate_profile(fourth)
        self.assertTrue(eligible_track(fourth, track(7, credits='abe', album='z')))

    def test_one_five_track_budget_with_no_solo_or_unrelated_catalog_contamination(self):
        pool = [track(i) for i in range(1, 8)] + [track(8, credits='b', popularity=100), track(9, credits='a', album='z', popularity=100), track(10, credits='x', popularity=100)]
        (selected, log), calls = self.select(pool)
        self.assertEqual(len(selected), 5)
        self.assertTrue(all(int(t['id']) < 8 for t in selected))
        self.assertEqual(len(log), 5)
        self.assertEqual({item['profile'] for item in log}, {PROFILE['key']})
        self.assertEqual(len([url for url, _ in calls if url.endswith('/top-tracks')]), 3)

    def test_recent_setlist_repertoire_precedes_more_popular_fallback(self):
        (selected, _), _ = self.select([track(1, popularity=1)] + [track(i, popularity=100) for i in range(2, 8)], {'Song 1': 10})
        self.assertEqual(selected[0]['name'], 'Song 1')

    def test_song_and_uri_dedup_are_shared_with_other_lineup_artists(self):
        pool = [track(1, name='Same'), track(2, name='Same - Live', credits='abc'), track(3), track(4)]
        (selected, _), _ = self.select(pool, seen_uris={track(3)['uri']}, seen_songs={'song 4'})
        self.assertEqual([t['name'] for t in selected], ['Same'])

    def test_unplayable_and_short_tracks_are_not_selected(self):
        first = track(1); first['is_playable'] = False
        second = track(2); second['duration_ms'] = 10000
        (selected, _), _ = self.select([first, second, track(3)])
        self.assertEqual([t['name'] for t in selected], ['Song 3'])

    def test_invalid_profiles_are_rejected(self):
        for change in [{'albumIds': []}, {'searchArtists': [PROFILE['searchArtists'][0]]},
                       {'anchorArtistIds': ['b' * 22]}, {'collaborationArtistIds': ['x' * 22]}, {'schemaVersion': 2}, {'schemaVersion': True}]:
            with self.assertRaises(ValueError): validate_profile({**PROFILE, **change})

    def test_provider_error_does_not_broaden_to_solo_catalogs(self):
        def fail(*args): raise RuntimeError('provider unavailable')
        with self.assertRaisesRegex(RuntimeError, 'provider unavailable'):
            select_tracks(PROFILE, {}, fail, str.lower, lambda t: False, lambda t: 0, set(), set())

    def test_real_planner_transports_profile_and_counts_one_act(self):
        import festival_playlists as planner
        value = {'season': 2027, 'festivals': [{'slug': 'festival', 'name': 'Festival', 'editionYear': 2027,
                  'headliners': [], 'artists': ['Joint Act'], 'playlistUrl': '', 'spotifyRepertoireProfiles': {'Joint Act': PROFILE}}]}
        _, festivals, _ = planner.parse_canonical_festivals(value)
        pool = [track(i) for i in range(1, 8)]
        def get(url, params):
            if url.endswith('/top-tracks'): return {'tracks': pool}
            if '/albums/' in url: return {'items': [{'id': t['id']} for t in pool], 'next': None}
            return {'tracks': [next(t for t in pool if t['id'] == ident) for ident in params['ids'].split(',')]}
        with patch.object(planner, 'REPORT_ONLY', True), patch.object(planner, 'search_artist_mbid', return_value=None), \
             patch.object(planner, 'spotify_get', side_effect=get), patch.object(planner, 'get_followers', side_effect=AssertionError('No audience aggregation')), \
             patch.object(planner, 'spotify_top_tracks', side_effect=AssertionError('No unscoped fallback')):
            result = planner.build_playlist(festivals[0], '', persist_report=False)
        self.assertEqual(result['artists_count'], 1)
        self.assertEqual(result['track_count'], 5)
        self.assertEqual(result['report'][0]['repertoire_profile'], PROFILE['key'])
        self.assertIsNone(result['report'][0]['followers'])

    def test_profile_cannot_be_attached_to_non_lineup_name(self):
        import festival_playlists as planner
        with self.assertRaisesRegex(ValueError, 'eligible lineup act'):
            planner.parse_canonical_festivals({'season': 2027, 'festivals': [{'slug': 'f', 'name': 'F', 'editionYear': 2027,
                'artists': ['Other'], 'spotifyRepertoireProfiles': {'Joint Act': PROFILE}}]})


if __name__ == '__main__': unittest.main()
