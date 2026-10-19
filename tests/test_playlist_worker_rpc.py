import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts/spotify_gmm_2026'
sys.path.insert(0, str(SCRIPTS))
import playlist_worker_rpc as rpc
import apply_playlist_plan as spotify
import spotify_auth
import youtube_playlist_plan as youtube


class FilelessWorkerTests(unittest.TestCase):
    def test_actual_spotify_discovery_pipeline_is_fileless_and_stdout_is_only_json(self):
        # Fresh interpreter exercises import-time behaviour too. The cwd is empty;
        # network matching is deterministic, but the real planner and CLI execute.
        harness = '''
import os,runpy,sys
os.environ['FESTIVAL_WORKER_STDIO']='1'
os.environ['FESTIVAL_REPORT_ONLY']='1'
import festival_playlists as planner
track={'uri':'spotify:track:'+'b'*22,'name':'Song','artists':[{'name':'Example Artist'}],'duration_ms':180000}
planner.get_followers=lambda *args:100
planner.search_artist_mbid=lambda *args:None
planner.spotify_top_tracks=lambda *args,**kwargs:(None,[track])
from pathlib import Path
from unittest.mock import patch
with patch.object(Path,'write_text',side_effect=AssertionError('file write')),patch.object(Path,'read_text',side_effect=AssertionError('file read')),patch.object(Path,'mkdir',side_effect=AssertionError('mkdir')):
    sys.argv=['playlist_worker_rpc.py','discover-spotify']
    runpy.run_path(os.environ['RPC_SCRIPT'],run_name='__main__')
'''
        value = {'season': 2027, 'festivals': [{'slug': 'synthetic', 'name': 'Synthetic', 'editionYear': 2027, 'headliners': ['Example Artist'], 'artists': ['Example Artist'], 'playlistUrl': ''}]}
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, '-B', '-c', harness], input=json.dumps(value), text=True, capture_output=True, cwd=directory,
                                    env={**os.environ, 'PYTHONPATH': str(SCRIPTS), 'RPC_SCRIPT': str(SCRIPTS / 'playlist_worker_rpc.py'), 'SETLIST_API_KEY': 'test-only'})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(directory).iterdir()), [])
        reply = json.loads(result.stdout)
        self.assertEqual(reply['track_uris'], ['spotify:track:' + 'b' * 22])
        self.assertEqual(reply['artists_count'], 1)
        self.assertIn('Example Artist', result.stderr)
        self.assertEqual(reply['playlist_url'], '')

    def test_spotify_apply_returns_verified_plan_and_keeps_existing_guards(self):
        value = {'playlist_id': 'a' * 22, 'playlist_url': 'https://open.spotify.com/playlist/' + 'a' * 22,
                 'track_uris': ['spotify:track:' + 'b' * 22], 'track_count': 1}
        response = type('Response', (), {'content': True, 'raise_for_status': lambda self: None,
                        'json': lambda self: {'items': [{'item': {'uri': value['track_uris'][0]}}], 'next': None}})()
        with patch.dict(os.environ, {'PLAYLIST_GUARD_NODE': 'node', 'PLAYLIST_GUARD_SCRIPT': 'guard.ts'}), \
             patch.object(spotify, 'auth_headers', return_value={}), \
             patch.object(spotify.subprocess, 'run') as guard, \
             patch.object(spotify.requests, 'request', return_value=response) as request, \
             patch('builtins.open', side_effect=AssertionError('file access')):
            self.assertEqual(rpc.execute('apply-spotify', value), value)
        self.assertEqual(request.call_count, 1)  # Already matches: no provider write.
        self.assertGreaterEqual(guard.call_count, 3)

    def test_youtube_plan_and_exit_categories_are_preserved(self):
        report = {'playlist_name': 'Synthetic', 'festival': 'Synthetic', 'report': [{'artist': 'Example Artist', 'tracks': ['Example Artist - Song']}]}
        discover = youtube.discover_plan
        with patch.object(youtube, 'discover_plan', side_effect=lambda value: discover(value, search=lambda query: {'videoId': '00000000001'})), patch('builtins.open', side_effect=AssertionError('file access')):
            result = rpc.execute('discover-youtube', {'sourceReport': report, 'slug': 'synthetic', 'editionYear': 2027, 'expectedUrl': ''})
        self.assertEqual(result['videoIds'], ['00000000001'])
        for error in [youtube.QuotaBoundReached(), youtube.ReconciliationRequired()]:
            with patch.object(youtube, 'run_plan', side_effect=error):
                with self.assertRaises(type(error)):
                    rpc.execute('apply-youtube', {})

    def test_cli_preserves_youtube_quota_and_reconciliation_exit_codes(self):
        harness = """
import os,runpy,sys
import youtube_playlist_plan as youtube
error=getattr(youtube,os.environ['RPC_ERROR'])
def fail(*args):raise error()
youtube.run_plan=fail
sys.argv=['playlist_worker_rpc.py','apply-youtube']
runpy.run_path(os.environ['RPC_SCRIPT'],run_name='__main__')
"""
        for category, code, marker in [('QuotaBoundReached', 2, 'youtube_quota_bound_reached'), ('ReconciliationRequired', 3, 'youtube_reconciliation_required')]:
            result = subprocess.run([sys.executable, '-B', '-c', harness], input='{}', text=True, capture_output=True,
                                    env={**os.environ, 'PYTHONPATH': str(SCRIPTS), 'RPC_SCRIPT': str(SCRIPTS / 'playlist_worker_rpc.py'), 'RPC_ERROR': category})
            self.assertEqual(result.returncode, code)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, marker + '\n')

    def test_worker_spotify_token_cache_is_memory_only(self):
        with patch.dict(os.environ, {'FESTIVAL_WORKER_STDIO': '1', 'SPOTIFY_REFRESH_TOKEN': 'test-only'}), \
             patch.object(spotify_auth, '_WORKER_TOKENS', None), \
             patch.object(Path, 'exists', side_effect=AssertionError('file read')), \
             patch.object(Path, 'mkdir', side_effect=AssertionError('mkdir')), \
             patch.object(Path, 'write_text', side_effect=AssertionError('file write')):
            self.assertEqual(spotify_auth.load_tokens()['refresh_token'], 'test-only')
            spotify_auth.save_tokens({'access_token': 'test-only-access'})
            self.assertEqual(spotify_auth.load_tokens(), {'access_token': 'test-only-access'})

    def test_cli_errors_do_not_expose_input_and_do_not_write_files(self):
        for operation, value in [('unknown', {}), ('apply-spotify', {'private': 'PRIVATE_VALUE'}), ('discover-spotify', {'private': 'PRIVATE_VALUE'})]:
            with tempfile.TemporaryDirectory() as directory:
                result = subprocess.run([sys.executable, '-B', str(SCRIPTS / 'playlist_worker_rpc.py'), operation], input=json.dumps(value), text=True, capture_output=True, cwd=directory)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, '')
                self.assertEqual(result.stderr, 'playlist_rpc_failed\n')
                self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
