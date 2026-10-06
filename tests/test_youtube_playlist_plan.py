import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'))
from youtube_playlist_plan import publish_plan, discover_plan, ReconciliationRequired, QuotaBoundReached

PLAYLIST = 'PLsynthetic001'
VIDEOS = [str(i).zfill(11) for i in range(1, 105)]


class Provider:
    def __init__(self, creating=False, videos=None):
        self.plan = {'slug': 'synthetic', 'editionYear': 2027, 'expectedUrl': '' if creating else f'https://music.youtube.com/playlist?list={PLAYLIST}',
                     'title': 'Synthetic festival', 'description': 'Synthetic description', 'videoIds': VIDEOS[:3], 'artists': 1, 'sourceTracks': 3}
        self.saved = {'marker': 'festival-radar:youtube:synthetic', 'sent': False, 'playlistId': None, 'creationMetadata': None, 'pendingInsert': None, 'pendingMetadata': None}
        self.metadata = None if creating else {'id': PLAYLIST, 'snippet': {'title': self.plan['title'], 'description': self.plan['description'], 'channelId': 'owner'}, 'status': {'privacyStatus': 'public'}}
        self.items = [{'id': f'item-{i}', 'video': v} for i, v in enumerate(videos or [])]
        self.serial = len(self.items)
        self.calls, self.progress = [], []
        self.fenced = False
        self.lost = False
        self.unknown = None
        self.delayed = False
        self.delayed_insert = None
        self.fail_bind = False
        self.drop_insert = False
        self.wrong_order = False
        self.duplicate_discovery = False

    def guard(self):
        if self.lost:
            raise RuntimeError('lease lost')
        self.fenced = True

    def state(self, action, payload=None):
        if self.lost:
            raise RuntimeError('lease lost')
        if action == 'reserve':
            if self.saved['sent']:
                raise AssertionError('create resent')
            self.saved['sent'] = True
            self.saved['creationMetadata'] = copy.deepcopy(payload)
        elif action == 'bind':
            if self.fail_bind:
                raise RuntimeError('ID persistence failed')
            self.saved['playlistId'] = payload
        elif action == 'insert':
            if self.saved['pendingInsert']:
                raise AssertionError('insert intent overwritten')
            self.saved['pendingInsert'] = copy.deepcopy(payload)
        elif action == 'confirm':
            if self.saved['pendingInsert'] != payload:
                raise AssertionError('wrong confirmation')
            self.saved['pendingInsert'] = None
        elif action == 'metadata':
            self.saved['pendingMetadata'] = copy.deepcopy(payload)
        elif action == 'metadata-confirm':
            if self.saved['pendingMetadata'] != payload:
                raise AssertionError('wrong metadata confirmation')
            self.saved['pendingMetadata'] = None
        return copy.deepcopy(self.saved)

    def request(self, method, url, **kwargs):
        if not self.fenced:
            raise AssertionError('provider call not fenced')
        self.fenced = False
        resource = url.rsplit('/', 1)[-1]
        self.calls.append((method, resource))
        params = kwargs.get('params', {})
        if resource == 'channels':
            return {'items': [{'id': 'owner'}], 'pageInfo': {'totalResults': 1}}
        if resource == 'playlists':
            if method == 'GET':
                items = [copy.deepcopy(self.metadata)] if self.metadata else []
                if self.duplicate_discovery and 'mine' in params:
                    items.append({**copy.deepcopy(self.metadata), 'id': 'PLduplicate001'})
                return {'items': items, 'pageInfo': {'totalResults': len(items)}}
            if method == 'POST':
                if not self.saved['sent']:
                    raise AssertionError('create intent not durable')
                self.metadata = {'id': PLAYLIST, 'snippet': {**kwargs['json']['snippet'], 'channelId': 'owner'}, 'status': kwargs['json']['status']}
                if self.unknown == 'create':
                    self.unknown = None
                    raise TimeoutError('create accepted remotely')
                return self.metadata
            if method == 'PUT':
                if not self.saved['pendingMetadata']:
                    raise AssertionError('metadata intent not durable')
                self.metadata = {'id': PLAYLIST, 'snippet': {**kwargs['json']['snippet'], 'channelId': 'owner'}, 'status': kwargs['json']['status']}
                if self.unknown == 'metadata':
                    self.unknown = None
                    raise TimeoutError('metadata accepted remotely')
                return self.metadata
        if resource == 'playlistItems':
            if method == 'GET':
                offset = int(params.get('pageToken', 0))
                items = [{'id': item['id'], 'snippet': {'playlistId': PLAYLIST, 'position': pos, 'resourceId': {'kind': 'youtube#video', 'videoId': item['video']}}}
                         for pos, item in enumerate(self.items)][offset:offset+50]
                result = {'items': items, 'pageInfo': {'totalResults': len(self.items)}}
                if offset + 50 < len(self.items):
                    result['nextPageToken'] = str(offset + 50)
                return result
            if method == 'DELETE':
                self.items = [item for item in self.items if item['id'] != params['id']]
                if self.unknown == 'delete':
                    self.unknown = None
                    raise TimeoutError('delete accepted remotely')
                return {}
            if method == 'POST':
                snippet = kwargs['json']['snippet']
                if self.saved['pendingInsert'] is None:
                    raise AssertionError('insert intent not durable')
                self.serial += 1
                item = {'id': f'new-{self.serial}', 'video': snippet['resourceId']['videoId']}
                if self.delayed:
                    self.delayed_insert = item
                elif not self.drop_insert:
                    self.items.insert(0 if self.wrong_order else snippet['position'], item)
                if self.unknown == 'insert':
                    self.unknown = None
                    raise TimeoutError('insert unknown')
                return {'id': item['id']}
        raise AssertionError('unexpected API request')

    def run(self, quota_limit=5000):
        return publish_plan(self.plan, self.request, self.guard, self.state, lambda data: self.progress.append(data), quota_limit=quota_limit)

    def writes(self, resource=None):
        return [call for call in self.calls if call[0] != 'GET' and (resource is None or call[1] == resource)]


class YoutubePlanTests(unittest.TestCase):
    def test_exact_existing_playlist_is_noop(self):
        provider = Provider(videos=VIDEOS[:3])
        self.assertEqual(provider.run()['tracks'], 3)
        self.assertEqual(provider.writes(), [])
        self.assertTrue(provider.progress[-1]['complete'])

    def test_repair_order_duplicates_and_extras_preserves_matching_prefix(self):
        provider = Provider(videos=[VIDEOS[0], VIDEOS[2], VIDEOS[2], VIDEOS[3]])
        provider.run()
        self.assertEqual([item['video'] for item in provider.items], VIDEOS[:3])
        self.assertEqual(len([call for call in provider.writes() if call[0] == 'DELETE']), 3)
        self.assertIsNone(provider.saved['pendingInsert'])

    def test_unknown_create_recovers_exact_marker_without_resend(self):
        provider = Provider(creating=True)
        provider.unknown = 'create'
        with self.assertRaises(TimeoutError): provider.run()
        provider.plan['title'] = 'Newer publication title'
        provider.plan['description'] = 'Newer publication description'
        provider.run()
        self.assertEqual(provider.writes('playlists').count(('POST', 'playlists')), 1)
        self.assertEqual(provider.metadata['snippet']['title'], provider.plan['title'])
        self.assertTrue(provider.progress[-1]['complete'])

    def test_unknown_create_absent_or_multiple_fails_closed(self):
        provider = Provider(creating=True)
        provider.saved['sent'] = True
        with self.assertRaises(ReconciliationRequired): provider.run()
        self.assertEqual(provider.writes(), [])
        provider.saved['sent'] = False
        provider.unknown = 'create'
        with self.assertRaises(TimeoutError): provider.run()
        provider.duplicate_discovery = True
        with self.assertRaises(ReconciliationRequired): provider.run()
        self.assertEqual(provider.writes('playlists').count(('POST', 'playlists')), 1)

    def test_creation_readback_then_id_persistence_loss_recovers(self):
        provider = Provider(creating=True)
        provider.fail_bind = True
        with self.assertRaises(RuntimeError): provider.run()
        provider.fail_bind = False
        provider.run()
        self.assertEqual(provider.writes('playlists').count(('POST', 'playlists')), 1)

    def test_unknown_insert_success_is_confirmed_not_resent(self):
        provider = Provider()
        provider.unknown = 'insert'
        with self.assertRaises(TimeoutError): provider.run()
        self.assertIsNotNone(provider.saved['pendingInsert'])
        provider.run()
        self.assertEqual(len([call for call in provider.writes() if call == ('POST', 'playlistItems')]), 3)
        self.assertEqual([item['video'] for item in provider.items], VIDEOS[:3])

    def test_lease_loss_after_intent_prevents_call_and_leaves_ambiguity_fenced(self):
        for creating, action in ((True, 'reserve'), (False, 'insert')):
            provider = Provider(creating=creating)
            def store(name, payload=None):
                result = provider.state(name, payload)
                if name == action:
                    provider.lost = True
                return result
            with self.assertRaises(RuntimeError):
                publish_plan(provider.plan, provider.request, provider.guard, store, provider.progress.append)
            self.assertEqual(provider.writes(), [])
            provider.lost = False
            with self.assertRaises(ReconciliationRequired): provider.run()
            self.assertEqual(provider.writes(), [])

    def test_delayed_unknown_insert_blocks_until_observed(self):
        provider = Provider()
        provider.unknown = 'insert'
        provider.delayed = True
        with self.assertRaises(TimeoutError): provider.run()
        writes = provider.writes()[:]
        with self.assertRaises(ReconciliationRequired): provider.run()
        self.assertEqual(provider.writes(), writes)
        provider.items.append(provider.delayed_insert)
        provider.delayed = False
        provider.run()
        self.assertEqual([item['video'] for item in provider.items], VIDEOS[:3])

    def test_unknown_insert_resolves_before_newer_plan_repairs_content(self):
        provider = Provider()
        provider.unknown = 'insert'
        with self.assertRaises(TimeoutError): provider.run()
        provider.plan['videoIds'] = VIDEOS[3:5]
        provider.run()
        self.assertEqual([item['video'] for item in provider.items], VIDEOS[3:5])

    def test_missing_or_misordered_insert_ack_does_not_claim_success(self):
        for attribute in ('drop_insert', 'wrong_order'):
            provider = Provider(videos=VIDEOS[:1])
            setattr(provider, attribute, True)
            with self.assertRaises(ReconciliationRequired): provider.run()
            self.assertFalse(provider.progress[-1]['complete'])
            self.assertIsNotNone(provider.saved['pendingInsert'])
            calls = provider.writes()[:]
            with self.assertRaises(ReconciliationRequired): provider.run()
            self.assertEqual(calls, provider.writes())

    def test_metadata_unknown_and_delete_unknown_reconcile(self):
        provider = Provider(videos=VIDEOS[:3])
        provider.metadata['snippet']['title'] = 'Old'
        provider.unknown = 'metadata'
        with self.assertRaises(TimeoutError): provider.run()
        provider.run()
        self.assertEqual(provider.writes('playlists'), [('PUT', 'playlists')])
        provider.items.append({'id': 'extra', 'video': VIDEOS[3]})
        provider.unknown = 'delete'
        with self.assertRaises(TimeoutError): provider.run()
        provider.run()
        self.assertEqual(provider.writes('playlistItems'), [('DELETE', 'playlistItems')])

    def test_quota_partial_progress_resumes_without_duplicates(self):
        provider = Provider()
        with self.assertRaises(QuotaBoundReached): provider.run(quota_limit=60)
        self.assertFalse(provider.progress[-1]['complete'])
        self.assertLessEqual(provider.progress[-1]['quotaUsed'], 60)
        provider.run()
        self.assertEqual(len([call for call in provider.writes() if call[0] == 'POST']), 3)
        self.assertTrue(provider.progress[-1]['complete'])

    def test_pagination_checks_complete_order_and_hidden_extras(self):
        provider = Provider(videos=VIDEOS[:104])
        provider.plan['videoIds'] = VIDEOS[:103]
        provider.plan['sourceTracks'] = 103
        provider.run()
        self.assertEqual(len(provider.items), 103)
        self.assertEqual(provider.writes(), [('DELETE', 'playlistItems')])

    def test_wrong_owner_and_lease_loss_prevent_mutations(self):
        provider = Provider()
        provider.metadata['snippet']['channelId'] = 'other-owner'
        with self.assertRaises(ReconciliationRequired): provider.run()
        self.assertEqual(provider.writes(), [])
        provider.lost = True
        with self.assertRaises(RuntimeError): provider.run()
        self.assertEqual(provider.writes(), [])

    def test_missing_pages_and_wrong_final_metadata_fail_closed(self):
        provider = Provider(videos=VIDEOS[:3])
        def incomplete(method, url, **kwargs):
            result = provider.request(method, url, **kwargs)
            if method == 'GET' and url.endswith('/playlistItems'):
                result['pageInfo']['totalResults'] += 1
            return result
        with self.assertRaises(ReconciliationRequired):
            publish_plan(provider.plan, incomplete, provider.guard, provider.state, provider.progress.append)
        self.assertEqual(provider.writes(), [])
        reads = 0
        def wrong_final(method, url, **kwargs):
            nonlocal reads
            result = provider.request(method, url, **kwargs)
            if method == 'GET' and url.endswith('/playlists'):
                reads += 1
                if reads == 2:
                    result['items'][0]['snippet']['title'] = 'Unexpected metadata'
            return result
        with self.assertRaises(ReconciliationRequired):
            publish_plan(provider.plan, wrong_final, provider.guard, provider.state, provider.progress.append)
        self.assertFalse(provider.progress[-1]['complete'])

    def test_discovery_uses_report_order_and_no_mapping_or_credentials(self):
        report = {'playlist_name': 'Festival', 'festival': 'Festival', 'report': [{'artist': 'Artist', 'tracks': ['Artist - One', 'Artist - Two', 'Artist - Three']}]}
        with patch.dict(os.environ, {'YOUTUBE_MUSIC_PLAYLIST_IDS': '{"synthetic":"PLwrong00000"}'}, clear=True):
            plan = discover_plan({'sourceReport': report, 'slug': 'synthetic', 'editionYear': 2027, 'expectedUrl': ''}, search=lambda query: {'videoId': VIDEOS[0 if query['title'] in ('One', 'Two') else 1]})
        self.assertEqual(plan['videoIds'], VIDEOS[:2])
        self.assertEqual(plan['expectedUrl'], '')
        self.assertEqual(plan['sourceTracks'], 3)

    def test_cli_failure_is_sanitized(self):
        script = Path(__file__).parents[1] / 'scripts/spotify_gmm_2026/youtube_playlist_plan.py'
        with tempfile.TemporaryDirectory() as directory:
            input_path = Path(directory) / 'input.json'
            input_path.write_text(json.dumps({'sensitive': 'SENSITIVE_PROVIDER_ID'}))
            result = subprocess.run([sys.executable, str(script), 'apply', str(input_path), str(Path(directory) / 'output.json')], capture_output=True, text=True, env={'PATH': os.environ.get('PATH', '')})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr, 'youtube_plan_failed\n')
        self.assertEqual(result.stdout, '')

    def test_legacy_publish_delegates_to_locked_mode_gate_before_reading_any_files(self):
        import youtube_music_transfer as legacy
        with patch.dict(os.environ, {}, clear=True), patch.object(sys, 'argv', ['youtube_music_transfer.py', '--publish', '--report', 'unused-report.json', '--output', 'unused-output.json']), patch.object(legacy, 'load_json', side_effect=AssertionError('legacy provider files read')), patch.object(legacy.subprocess, 'run', return_value=type('Completed', (), {'returncode': 1})()) as run:
            self.assertEqual(legacy.main(), 1)
        self.assertIn('playlist-lease-guard.ts', run.call_args.args[0][2])
        self.assertIn('--legacy-youtube', run.call_args.args[0])
        self.assertIn('--publish', run.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
