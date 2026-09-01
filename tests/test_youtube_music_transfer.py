import os
import sys
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault('SETLIST_API_KEY', 'test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'spotify_gmm_2026'))

import youtube_music_transfer as transfer
import youtube_music_auto_resume as auto_resume


class YouTubeMusicTransferTest(unittest.TestCase):
    def test_search_errors_are_counted_without_caching_provider_text(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Example Song',
        }
        response = mock.Mock(status_code=401)
        error = RuntimeError('provider-private-text')
        error.response = response
        ytmusic = mock.Mock()
        ytmusic.search.side_effect = error
        cache = {}
        stats = {}

        result = transfer.search_youtube_track(ytmusic, query, cache, stats=stats)

        self.assertIsNone(result)
        self.assertEqual(cache, {})
        self.assertEqual(stats['authentication_errors'], 2)
        self.assertEqual(stats['empty_results'], 1)

    def test_parse_report_tracks_deduplicates_artist_title_pairs(self):
        report = {
            'report': [
                {
                    'artist': 'Example Artist',
                    'query_artist': 'Example Artist',
                    'tracks': ['Example Artist - Song - 2024 Remaster', 'Example Artist - Song'],
                }
            ]
        }

        tracks = transfer.parse_report_tracks(report)

        self.assertEqual(len(tracks), 1)
        self.assertEqual(tracks[0]['title'], 'Song - 2024 Remaster')

    def test_candidate_score_accepts_clean_song_match(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNotNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_rejects_live_version(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song - Live at Wacken',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_rejects_youtube_specific_bad_version(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song',
        }
        candidate = {
            'title': 'Clean Song (Club Version)',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNone(transfer.youtube_candidate_score(query, candidate))

    def test_candidate_score_accepts_version_when_source_requested_it(self):
        query = {
            'artist': 'Example Artist',
            'query_artist': 'Example Artist',
            'lineup_artist': 'Example Artist',
            'title': 'Clean Song (Club Version)',
        }
        candidate = {
            'title': 'Clean Song (Club Version)',
            'videoId': 'video-id',
            'resultType': 'song',
            'duration_seconds': 180,
            'artists': [{'name': 'Example Artist'}],
        }

        self.assertIsNotNone(transfer.youtube_candidate_score(query, candidate))

    def test_build_report_counts_duplicates_and_missing(self):
        source = {'festival': 'Example', 'playlist_name': 'Example', 'playlist_url': 'spotify-url'}
        matched = [
            {'label': 'A - Song', 'title': 'Song', 'videoId': 'same'},
            {'label': 'B - Song', 'title': 'Song', 'videoId': 'same'},
        ]

        report = transfer.build_youtube_report(source, matched, matched, [{'label': 'missing'}])

        self.assertEqual(report['matched_track_count'], 2)
        self.assertEqual(report['missing_track_count'], 1)
        self.assertEqual(report['duplicate_video_ids'], ['same'])
        self.assertEqual(report['duplicate_song_keys'], ['B - Song'])

    def test_sync_resume_caps_new_items_and_reports_remaining(self):
        current = [
            {'id': 'item-1', 'snippet': {'resourceId': {'videoId': 'already-there'}}},
        ]

        with (
            mock.patch.object(transfer, 'list_youtube_playlist_items', return_value=current),
            mock.patch.object(transfer, 'delete_youtube_playlist_item') as delete_item,
            mock.patch.object(transfer, 'add_youtube_playlist_item') as add_item,
        ):
            summary = transfer.sync_youtube_playlist_items(
                Path('credentials.json'),
                Path('oauth.json'),
                'playlist-id',
                ['already-there', 'new-1', 'new-2', 'new-3'],
                resume=True,
                max_new_items=2,
            )

        delete_item.assert_not_called()
        self.assertEqual([call.args[3] for call in add_item.call_args_list], ['new-1', 'new-2'])
        self.assertEqual(summary['existing_count'], 1)
        self.assertEqual(summary['queued_count'], 3)
        self.assertEqual(summary['inserted_count'], 2)
        self.assertEqual(summary['remaining_count'], 1)
        self.assertEqual(summary['estimated_read_quota_units'], 1)
        self.assertEqual(summary['estimated_write_quota_units'], 100)

    def test_publish_existing_playlist_skips_metadata_update_by_default(self):
        source = {'playlist_name': 'Example Playlist'}

        with (
            mock.patch.object(transfer, 'update_youtube_playlist') as update_playlist,
            mock.patch.object(transfer, 'create_youtube_playlist') as create_playlist,
            mock.patch.object(
                transfer,
                'sync_youtube_playlist_items',
                return_value={
                    'existing_count': 0,
                    'deleted_count': 0,
                    'queued_count': 1,
                    'inserted_count': 1,
                    'remaining_count': 0,
                    'estimated_read_quota_units': 1,
                    'estimated_write_quota_units': 50,
                },
            ) as sync_items,
            mock.patch.object(
                transfer,
                'read_back_youtube_playlist',
                return_value={
                    'playlist_id': 'playlist-id',
                    'metadata_matches': True,
                    'track_count': 1,
                    'unique_track_count': 1,
                    'requested_tracks_present': 1,
                },
            ) as read_back,
        ):
            playlist_id, playlist_url, summary = transfer.publish_playlist(
                source,
                ['video-1'],
                'playlist-id',
                Path('credentials.json'),
                Path('oauth.json'),
                resume=True,
                update_metadata=False,
                max_new_items=190,
            )

        update_playlist.assert_not_called()
        create_playlist.assert_not_called()
        sync_items.assert_called_once()
        read_back.assert_called_once()
        self.assertEqual(playlist_id, 'playlist-id')
        self.assertEqual(playlist_url, 'https://music.youtube.com/playlist?list=playlist-id')
        self.assertEqual(summary['metadata_quota_units'], 0)
        self.assertEqual(summary['estimated_total_write_quota_units'], 50)
        self.assertEqual(summary['estimated_total_quota_units'], 51)
        self.assertTrue(summary['read_back']['metadata_matches'])

    def test_read_back_requires_matching_metadata_and_deduplicated_tracks(self):
        playlist_response = {
            'items': [{
                'id': 'playlist-id',
                'snippet': {'title': 'Example Playlist', 'description': 'Example Description'},
            }],
        }
        playlist_items = [
            {'snippet': {'resourceId': {'videoId': 'video-1'}}},
            {'snippet': {'resourceId': {'videoId': 'video-2'}}},
        ]
        with (
            mock.patch.object(transfer, 'youtube_data_api_headers', return_value={}),
            mock.patch.object(transfer, 'youtube_data_api_request', return_value=playlist_response),
            mock.patch.object(transfer, 'list_youtube_playlist_items', return_value=playlist_items),
        ):
            result = transfer.read_back_youtube_playlist(
                Path('credentials.json'),
                Path('oauth.json'),
                'playlist-id',
                'Example Playlist',
                'Example Description',
                ['video-2'],
            )

        self.assertEqual(result['playlist_id'], 'playlist-id')
        self.assertEqual(result['track_count'], 2)
        self.assertEqual(result['unique_track_count'], 2)
        self.assertEqual(result['requested_tracks_present'], 1)

    def test_read_back_rejects_duplicate_tracks(self):
        playlist_response = {
            'items': [{
                'id': 'playlist-id',
                'snippet': {'title': 'Example Playlist', 'description': 'Example Description'},
            }],
        }
        duplicate_items = [
            {'snippet': {'resourceId': {'videoId': 'video-1'}}},
            {'snippet': {'resourceId': {'videoId': 'video-1'}}},
        ]
        with (
            mock.patch.object(transfer, 'youtube_data_api_headers', return_value={}),
            mock.patch.object(transfer, 'youtube_data_api_request', return_value=playlist_response),
            mock.patch.object(transfer, 'list_youtube_playlist_items', return_value=duplicate_items),
        ):
            with self.assertRaisesRegex(RuntimeError, 'contains duplicates'):
                transfer.read_back_youtube_playlist(
                    Path('credentials.json'),
                    Path('oauth.json'),
                    'playlist-id',
                    'Example Playlist',
                    'Example Description',
                    ['video-1'],
                )

    def test_publish_refuses_empty_matched_track_set_before_mutation(self):
        with mock.patch.object(transfer, 'update_youtube_playlist') as update_playlist:
            with self.assertRaisesRegex(RuntimeError, 'no matched tracks'):
                transfer.publish_playlist(
                    {'playlist_name': 'Example Playlist'},
                    [],
                    'playlist-id',
                    Path('credentials.json'),
                    Path('oauth.json'),
                    resume=True,
                    update_metadata=True,
                    max_new_items=190,
                )
        update_playlist.assert_not_called()

    def test_auto_resume_detects_quota_errors(self):
        self.assertTrue(auto_resume.is_quota_error(RuntimeError('quotaExceeded')))
        self.assertTrue(auto_resume.is_quota_error(RuntimeError('Quota exceeded')))
        self.assertFalse(auto_resume.is_quota_error(RuntimeError('invalid playlist id')))

    def test_auto_resume_reports_quota_wait_from_transfer_failure(self):
        args = mock.Mock(
            playlist_id='playlist-id',
            credentials=Path('credentials.json'),
            oauth=Path('oauth.json'),
            report=Path('report.json'),
            output=Path('output.json'),
            cache=Path('cache.json'),
            max_new_items=190,
            pause_seconds=0,
        )
        completed = subprocess_result(
            returncode=1,
            stdout='',
            stderr='RuntimeError: YouTube Data API failed: 403 quotaExceeded',
        )

        with mock.patch.object(auto_resume.subprocess, 'run', return_value=completed):
            result = auto_resume.run_transfer(args)

        self.assertEqual(result['step'], 'publish')
        self.assertEqual(result['status'], 'quota_wait')


def subprocess_result(returncode: int, stdout: str, stderr: str):
    return mock.Mock(returncode=returncode, stdout=stdout, stderr=stderr)


if __name__ == '__main__':
    unittest.main()
