import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault('SETLIST_API_KEY', 'test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'spotify_gmm_2026'))

import festival_playlists as playlists


def make_track(name='Song', artists=None, duration_ms=180_000):
    return {
        'name': name,
        'artists': [{'name': artist} for artist in (artists or ['Example Artist'])],
        'duration_ms': duration_ms,
        'id': name.lower().replace(' ', '-'),
    }


class TrackFilterTest(unittest.TestCase):
    def test_import_without_setlist_key_for_offline_analysis(self):
        module_path = Path(__file__).resolve().parents[1] / 'scripts' / 'spotify_gmm_2026' / 'festival_playlists.py'

        with patch.dict(os.environ, {}, clear=True):
            spec = importlib.util.spec_from_file_location('festival_playlists_no_key', module_path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)

        self.assertIsNone(module.SETLIST_API_KEY)
        self.assertNotIn('x-api-key', module.SETLIST_HEADERS)
        with self.assertRaisesRegex(RuntimeError, 'SETLIST_API_KEY is required'):
            module.require_setlist_api_key()

    def test_cache_only_mbid_search_uses_saved_report_without_setlist_api(self):
        playlists.MBID_CACHE.clear()
        with patch.object(playlists, 'PERSISTENT_MBID_CACHE', {'Example Artist': 'cached-mbid'}), \
                patch.object(playlists, 'CACHE_ONLY_SETLIST', True), \
                patch.object(playlists, 'sl_get') as sl_get:
            self.assertEqual(playlists.search_artist_mbid('Example Artist'), 'cached-mbid')

        sl_get.assert_not_called()

    def test_cache_only_mbid_search_skips_uncached_setlist_api(self):
        playlists.MBID_CACHE.clear()
        with patch.object(playlists, 'PERSISTENT_MBID_CACHE', {}), \
                patch.object(playlists, 'CACHE_ONLY_SETLIST', True), \
                patch.object(playlists, 'sl_get') as sl_get:
            self.assertIsNone(playlists.search_artist_mbid('Missing Artist'))

        sl_get.assert_not_called()

    def test_skips_tracks_where_lineup_artist_is_only_featured(self):
        track = make_track(artists=['Kontra K', 'Anna Grey'])

        self.assertEqual(playlists.should_skip_track_for_artist('Anna Grey', track), 'primary_artist_mismatch')

    def test_skips_tracks_where_lineup_artist_is_secondary_collaborator(self):
        track = make_track(name='RATATATA', artists=['BABYMETAL', 'Electric Callboy'])

        self.assertEqual(playlists.should_skip_track_for_artist('Electric Callboy', track), 'primary_artist_mismatch')

    def test_accepts_primary_artist_match_with_featured_guests(self):
        track = make_track(artists=['Anna Grey', 'Kontra K'])

        self.assertIsNone(playlists.should_skip_track_for_artist('Anna Grey', track))

    def test_accepts_alias_primary_artist_match(self):
        track = make_track(artists=['Cavalera Conspiracy'])

        self.assertIsNone(playlists.should_skip_track_for_artist('Cavalera', track))

    def test_blocks_known_bad_primary_artist_prefix_match(self):
        track = make_track(artists=['Phantom Planet'])

        self.assertEqual(playlists.should_skip_track_for_artist('Phantom', track), 'primary_artist_mismatch')

    def test_skips_single_token_artist_as_secondary_primary_token(self):
        track = make_track(artists=['Sub Focus'])

        self.assertEqual(playlists.should_skip_track_for_artist('Focus.', track), 'primary_artist_mismatch')

    def test_skips_two_token_partial_artist_match(self):
        track = make_track(artists=['Victor Ray'])

        self.assertEqual(playlists.should_skip_track_for_artist('Kay Ray', track), 'primary_artist_mismatch')

    def test_skips_two_token_partial_artist_match_in_fallback(self):
        track = make_track(artists=['Metal Carter'])

        self.assertEqual(playlists.should_skip_track_for_artist('Metal Karate', track), 'primary_artist_mismatch')

    def test_accepts_lineup_artist_with_featuring_clause_as_base_artist(self):
        track = make_track(artists=['Sex Pistols'])

        self.assertIsNone(playlists.should_skip_track_for_artist('Sex Pistols featuring Frank Carter', track))

    def test_setlist_lookup_strips_featuring_clause(self):
        self.assertEqual(playlists.setlist_lookup_name('Sex Pistols featuring Frank Carter'), 'Sex Pistols')

    def test_single_token_mbid_search_requires_exact_artist_name(self):
        response = {'artist': [{'name': 'Twilight Force', 'mbid': 'twilight-force-mbid'}]}

        playlists.MBID_CACHE.clear()
        with patch.object(playlists, 'sl_get', return_value=response):
            self.assertIsNone(playlists.search_artist_mbid('Force'))

    def test_single_token_mbid_search_accepts_exact_artist_name(self):
        response = {'artist': [{'name': 'Force', 'mbid': 'force-mbid'}]}

        playlists.MBID_CACHE.clear()
        with patch.object(playlists, 'sl_get', return_value=response):
            self.assertEqual(playlists.search_artist_mbid('Force'), 'force-mbid')

    def test_rock_im_park_uses_2026_snapshot_when_live_page_has_no_lineup(self):
        class Response:
            text = '<html><title>Rock im Park 2027</title></html>'

        with patch.object(playlists.requests, 'get', return_value=Response()):
            artists, headliners = playlists.fetch_rock_im_park()

        self.assertIn('Electric Callboy', artists)
        self.assertEqual(headliners, playlists.ROCK_IM_PARK_2026_HEADLINERS)

    def test_refuses_to_overwrite_existing_playlist_with_empty_lineup(self):
        festival = playlists.Festival(
            key='empty_test',
            display_name='Empty Test',
            playlist_name='Empty Test',
            description='Empty Test',
            lineup_fn=lambda: ([], []),
            existing_playlist_id='playlist-id',
        )

        with self.assertRaisesRegex(RuntimeError, 'lineup is empty'):
            playlists.build_playlist(festival, 'user-id')

    def test_spotify_search_prefers_clean_version_over_feat_version(self):
        clean = make_track(name='Festival Song', artists=['Example Artist'])
        clean.update({'uri': 'spotify:track:clean', 'popularity': 50})
        feat = make_track(name='Festival Song (feat. Guest)', artists=['Example Artist', 'Guest'])
        feat.update({'uri': 'spotify:track:feat', 'popularity': 90})

        with patch.object(playlists, 'spotify_get', return_value={'tracks': {'items': [feat, clean]}}):
            result = playlists.spotify_search_track('Example Artist', 'Festival Song')

        self.assertEqual(result['uri'], 'spotify:track:clean')

    def test_spotify_top_tracks_prefers_clean_versions_before_feat_versions(self):
        artist = {'id': 'artist-id', 'name': 'Example Artist', 'followers': {'total': 1}}
        clean = make_track(name='Clean Song', artists=['Example Artist'])
        clean.update({'uri': 'spotify:track:clean', 'popularity': 50})
        feat = make_track(name='Featured Song (feat. Guest)', artists=['Example Artist', 'Guest'])
        feat.update({'uri': 'spotify:track:feat', 'popularity': 90})

        with patch.object(playlists, 'spotify_get_artist_by_id', return_value=artist), \
                patch.object(playlists, 'spotify_get', return_value={'tracks': [feat, clean]}):
            _, tracks = playlists.spotify_top_tracks('Example Artist', limit=2, artist_id='artist-id')

        self.assertEqual([track['uri'] for track in tracks], ['spotify:track:clean', 'spotify:track:feat'])

    def test_tom_morello_accepts_live_repertoire_primary_artists(self):
        for primary_artist in ['Tom Morello', 'Rage Against The Machine', 'Audioslave', 'Prophets Of Rage']:
            with self.subTest(primary_artist=primary_artist):
                track = make_track(artists=[primary_artist])

                self.assertIsNone(playlists.should_skip_track_for_artist('Tom Morello', track, 'Tom Morello'))

    def test_tom_morello_setlist_search_includes_live_repertoire_artists(self):
        calls = []
        rage_track = make_track(name='Bulls On Parade', artists=['Rage Against The Machine'])
        rage_track.update({'uri': 'spotify:track:rage', 'popularity': 80, 'id': 'rage'})

        def fake_spotify_get(_url, params):
            calls.append(params['q'])
            if params['q'] == 'track:Bulls On Parade artist:Rage Against The Machine':
                return {'tracks': {'items': [rage_track]}}
            return {'tracks': {'items': []}}

        with patch.object(playlists, 'spotify_get', side_effect=fake_spotify_get):
            result = playlists.spotify_search_track('Tom Morello', 'Bulls On Parade', 'Tom Morello')

        self.assertEqual(result['uri'], 'spotify:track:rage')
        self.assertIn('track:Bulls On Parade artist:Rage Against The Machine', calls)

    def test_montreal_rejects_of_montreal_prefix_match(self):
        track = make_track(artists=['of Montreal'])

        self.assertEqual(
            playlists.should_skip_track_for_artist('Montreal', track, 'Montreal'),
            'primary_artist_mismatch',
        )

    def test_identical_fallback_names_are_searched_once_with_ten_tracks(self):
        festival = playlists.Festival(
            key='fallback_test',
            display_name='Fallback Test',
            playlist_name='Fallback Test',
            description='Fallback Test',
            lineup_fn=lambda: (['Example Artist'], []),
            existing_playlist_id='playlist-id',
        )
        tracks = []
        for index in range(1, 6):
            track = make_track(name=f'Song {index}', artists=['Example Artist'])
            track.update({'uri': f'spotify:track:{index}', 'popularity': 100 - index})
            tracks.append(track)

        with tempfile.TemporaryDirectory() as tmpdir:
            report_dir = Path(tmpdir) / 'reports'
            cache_file = Path(tmpdir) / 'cache' / 'setlist_cache.json'
            report_dir.mkdir(parents=True)
            cache_file.parent.mkdir(parents=True)

            with patch.object(playlists, 'REPORT_DIR', report_dir), \
                    patch.object(playlists, 'SETLIST_CACHE_FILE', cache_file), \
                    patch.object(playlists, 'search_artist_mbid', return_value=None), \
                    patch.object(playlists, 'get_followers', return_value=1), \
                    patch.object(playlists, 'spotify_top_tracks', return_value=({'id': 'artist-id'}, tracks)) as top_tracks, \
                    patch.object(playlists, 'update_playlist_details'), \
                    patch.object(playlists, 'playlist_replace_all'), \
                    patch('builtins.print'):
                playlists.build_playlist(festival, 'user-id')

        top_tracks.assert_called_once_with('Example Artist', 10, artist_id=None)

    def test_report_only_build_does_not_mutate_spotify_playlist(self):
        festival = playlists.Festival(
            key='report_only_test',
            display_name='Report Only Test',
            playlist_name='Report Only Test',
            description='Report Only Test',
            lineup_fn=lambda: (['Example Artist'], []),
            existing_playlist_id='playlist-id',
        )
        track = make_track(name='Song 1', artists=['Example Artist'])
        track['uri'] = 'spotify:track:1'
        tracks = [track]

        with tempfile.TemporaryDirectory() as tmpdir:
            report_dir = Path(tmpdir) / 'reports'
            cache_file = Path(tmpdir) / 'cache' / 'setlist_cache.json'
            report_dir.mkdir(parents=True)
            cache_file.parent.mkdir(parents=True)

            with patch.object(playlists, 'REPORT_ONLY', True), \
                    patch.object(playlists, 'REPORT_DIR', report_dir), \
                    patch.object(playlists, 'SETLIST_CACHE_FILE', cache_file), \
                    patch.object(playlists, 'search_artist_mbid', return_value=None), \
                    patch.object(playlists, 'get_followers', return_value=1), \
                    patch.object(playlists, 'spotify_top_tracks', return_value=({'id': 'artist-id'}, tracks)), \
                    patch.object(playlists, 'update_playlist_details') as update_details, \
                    patch.object(playlists, 'playlist_replace_all') as replace_all, \
                    patch('builtins.print'):
                playlists.build_playlist(festival, 'user-id')

        update_details.assert_not_called()
        replace_all.assert_not_called()

    def test_selected_artists_require_report_only_mode(self):
        festival = playlists.Festival(
            key='selected_artist_test',
            display_name='Selected Artist Test',
            playlist_name='Selected Artist Test',
            description='Selected Artist Test',
            lineup_fn=lambda: (['Example Artist'], []),
            existing_playlist_id='playlist-id',
        )

        with patch.dict(os.environ, {'FESTIVAL_ARTISTS': 'Example Artist'}), \
                patch.object(playlists, 'REPORT_ONLY', False):
            with self.assertRaisesRegex(RuntimeError, 'FESTIVAL_ARTISTS can only be used'):
                playlists.build_playlist(festival, 'user-id')

    def test_report_only_selected_artists_merge_existing_report(self):
        festival = playlists.Festival(
            key='selected_artist_merge_test',
            display_name='Selected Artist Merge Test',
            playlist_name='Selected Artist Merge Test',
            description='Selected Artist Merge Test',
            lineup_fn=lambda: (['Example Artist', 'Other Artist'], []),
            existing_playlist_id='playlist-id',
        )
        replacement = make_track(name='Replacement Song', artists=['Example Artist'])
        replacement['uri'] = 'spotify:track:replacement'
        existing_report = {
            'festival': 'Selected Artist Merge Test',
            'playlist_name': 'Selected Artist Merge Test',
            'playlist_id': 'playlist-id',
            'playlist_url': 'https://open.spotify.com/playlist/playlist-id',
            'track_count': 10,
            'artists_count': 2,
            'headliners': [],
            'report': [
                {'artist': 'Example Artist', 'query_artist': 'Example Artist', 'count': 5, 'tracks': ['old']},
                {'artist': 'Other Artist', 'query_artist': 'Other Artist', 'count': 5, 'tracks': ['kept']},
            ],
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            report_dir = Path(tmpdir) / 'reports'
            cache_file = Path(tmpdir) / 'cache' / 'setlist_cache.json'
            report_dir.mkdir(parents=True)
            cache_file.parent.mkdir(parents=True)
            report_path = report_dir / 'selected_artist_merge_test.json'
            report_path.write_text(json.dumps(existing_report), encoding='utf-8')

            with patch.dict(os.environ, {'FESTIVAL_ARTISTS': 'Example Artist'}), \
                    patch.object(playlists, 'REPORT_ONLY', True), \
                    patch.object(playlists, 'REPORT_DIR', report_dir), \
                    patch.object(playlists, 'SETLIST_CACHE_FILE', cache_file), \
                    patch.object(playlists, 'search_artist_mbid', return_value=None), \
                    patch.object(playlists, 'get_followers', return_value=1), \
                    patch.object(playlists, 'spotify_top_tracks', return_value=({'id': 'artist-id'}, [replacement])), \
                    patch.object(playlists, 'update_playlist_details') as update_details, \
                    patch.object(playlists, 'playlist_replace_all') as replace_all, \
                    patch('builtins.print'):
                playlists.build_playlist(festival, 'user-id')

            merged = json.loads(report_path.read_text(encoding='utf-8'))

        self.assertEqual(merged['track_count'], 6)
        self.assertEqual(merged['artists_count'], 2)
        self.assertEqual(merged['report'][0]['tracks'], ['Example Artist - Replacement Song'])
        self.assertEqual(merged['report'][1]['tracks'], ['kept'])
        update_details.assert_not_called()
        replace_all.assert_not_called()

    def test_retry_after_wait_is_capped(self):
        response = playlists.requests.Response()
        response.headers['Retry-After'] = '9999'

        self.assertEqual(playlists.retry_wait_seconds(response, 10), playlists.MAX_RETRY_AFTER_SECONDS)

    def test_retry_after_invalid_value_uses_fallback(self):
        response = playlists.requests.Response()
        response.headers['Retry-After'] = 'soon'

        self.assertEqual(playlists.retry_wait_seconds(response, 10), 10)

    def test_setlist_tracks_sort_by_recent_plays_before_spotify_popularity(self):
        frequent = make_track(name='Frequent Song')
        popular = make_track(name='Popular Song')

        ranked = sorted([
            (95, 2, 'Popular Song', popular),
            (50, 5, 'Frequent Song', frequent),
        ], key=playlists.setlist_track_sort_key)

        self.assertEqual(ranked[0][2], 'Frequent Song')

    def test_recent_setlists_treats_404_as_no_setlists(self):
        response = playlists.requests.Response()
        response.status_code = 404
        error = playlists.requests.exceptions.HTTPError(response=response)

        playlists.SETLIST_CACHE.clear()
        with patch.object(playlists, 'PERSISTENT_SETLIST_CACHE', {}), \
                patch.object(playlists, 'sl_get', side_effect=error):
            self.assertEqual(playlists.recent_setlists('missing-mbid'), [])
            self.assertEqual(playlists.SETLIST_CACHE['missing-mbid'], [])

    def test_live_word_inside_song_title_is_not_live_version(self):
        track = make_track(name='Live It Up', artists=['Example Artist'])

        self.assertEqual(playlists.track_version_penalty(track), 0)
        self.assertIsNone(playlists.should_skip_track_for_artist('Example Artist', track))

    def test_live_version_marker_is_penalized(self):
        track = make_track(name='Clean Song - Live at Wacken', artists=['Example Artist'])

        self.assertEqual(playlists.track_version_penalty(track), 2)
        self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', track), 'bad_version')

    def test_edit_version_marker_is_rejected(self):
        track = make_track(name='Clean Song - edit', artists=['Example Artist'])

        self.assertEqual(playlists.track_version_penalty(track), 2)
        self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', track), 'bad_version')

    def test_radio_and_extended_versions_are_rejected(self):
        radio = make_track(name='Clean Song - Radio Version', artists=['Example Artist'])
        extended = make_track(name='Clean Song - Extended Version', artists=['Example Artist'])

        self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', radio), 'bad_version')
        self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', extended), 'bad_version')

    def test_named_album_version_is_not_rejected(self):
        track = make_track(name='Everytime We Touch - TEKKNO Version', artists=['Example Artist'])

        self.assertEqual(playlists.track_version_penalty(track), 0)
        self.assertIsNone(playlists.should_skip_track_for_artist('Example Artist', track))

    def test_bad_descriptor_versions_are_rejected(self):
        tracks = [
            make_track(name='Clean Song - Piano Version', artists=['Example Artist']),
            make_track(name='Clean Song - Saltatio Mortis Version', artists=['Example Artist']),
            make_track(name='Clean Song - Unplugged Version', artists=['Example Artist']),
        ]

        for track in tracks:
            with self.subTest(track=track['name']):
                self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', track), 'bad_version')

    def test_cover_marker_is_rejected_but_recovery_is_not(self):
        cover = make_track(name='Clean Song - Cover', artists=['Example Artist'])
        recovery = make_track(name='Recovery', artists=['Example Artist'])

        self.assertEqual(playlists.should_skip_track_for_artist('Example Artist', cover), 'bad_version')
        self.assertEqual(playlists.track_version_penalty(recovery), 0)
        self.assertIsNone(playlists.should_skip_track_for_artist('Example Artist', recovery))

    def test_intro_word_inside_title_is_not_rejected(self):
        track = make_track(name='The Introspection Song', artists=['Example Artist'])

        self.assertFalse(playlists.is_short_or_non_song(track))

    def test_intro_marker_is_rejected(self):
        track = make_track(name='Intro: The Beginning', artists=['Example Artist'])

        self.assertTrue(playlists.is_short_or_non_song(track))

    def test_remaster_suffix_deduplicates_with_original_title(self):
        self.assertEqual(
            playlists.canonical_track_key('Fear of the Dark - 2015 Remaster'),
            playlists.canonical_track_key('Fear of the Dark'),
        )

    def test_fetch_wacken_strips_out_of_the_cage_prefix(self):
        class Response:
            def json(self):
                return [{'artist': {'title': 'Out Of The Cage - Example Band'}}]

        with patch.object(playlists.requests, 'get', return_value=Response()):
            artists, _ = playlists.fetch_wacken()

        self.assertEqual(artists, ['Example Band'])

    def test_wacken_excludes_non_band_listing_entries(self):
        festival = playlists.Festival(
            key='wacken_test',
            display_name='Wacken Test',
            playlist_name='Wacken Test',
            description='Wacken Test',
            lineup_fn=lambda: ([], []),
            extra_excludes={
                'Acoustic Guerillas feat Ellerbek Pussyboys',
                'Acoustic Steel',
                'Adrian Pauls Rockin\' Roncalli Show',
                'Bastian Zach',
                'Blaas of Glory',
                'Corrupted Blood - Pit Session',
                'Dragons & Pois Show',
                'Jazz Sabbath',
                'Kay Ray',
                'Lesung: Maxim Matthew "Frøstfǽdrin- Der Ruf des weißen Greifen"',
                'Metal Karate',
                'Metal Battle tba.',
                'System of a Down by Anett & Livi Acoustic + Radó Éden',
                'The Ukeboys',
                'Tribute2Wacken',
                'Vika Goes Wild',
                'Wildcover',
            },
        )

        for artist in festival.extra_excludes:
            self.assertTrue(playlists.should_exclude(artist, festival))

    def test_festival_specific_excludes_non_band_program_entries(self):
        graspop = playlists.Festival(
            key='graspop_test',
            display_name='Graspop Test',
            playlist_name='Graspop Test',
            description='Graspop Test',
            lineup_fn=lambda: ([], []),
            extra_excludes={'Bulls on Parade'},
        )
        summer_breeze = playlists.Festival(
            key='summer_breeze_test',
            display_name='Summer Breeze Test',
            playlist_name='Summer Breeze Test',
            description='Summer Breeze Test',
            lineup_fn=lambda: ([], []),
            extra_excludes={
                'Harsh Vocals mit Britta Görtz',
                'Into The Voidcast',
                'Metal Yoga',
                'Metalza – Metal Workout',
            },
        )

        self.assertTrue(playlists.should_exclude('Bulls on Parade', graspop))
        for artist in summer_breeze.extra_excludes:
            with self.subTest(artist=artist):
                self.assertTrue(playlists.should_exclude(artist, summer_breeze))


if __name__ == '__main__':
    unittest.main()
