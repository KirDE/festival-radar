#!/usr/bin/env python3
"""Offline provider read-back for the actual worker/DB fence integration test."""
from pathlib import Path
import runpy
import sys
from unittest.mock import patch

script = sys.argv[1]
sys.argv = sys.argv[1:]
sys.path.insert(0, str(Path(script).parent))
import requests
import spotify_auth
import youtube_music_transfer
spotify_auth.auth_headers = lambda: {}
youtube_music_transfer.youtube_data_api_headers = lambda *args: {}


def request(method, url, **kwargs):
    if method != 'GET':
        raise AssertionError('Provider writes are forbidden in this read-back fixture')
    if 'spotify.com' in url:
        value = {'items': [{'item': {'uri': 'spotify:track:' + 'b' * 22}}], 'next': None}
    elif url.endswith('channels'):
        value = {'items': [{'id': 'owner'}], 'pageInfo': {'totalResults': 1}}
    elif url.endswith('playlists'):
        value = {'items': [{'id': 'PLsynthetic001', 'snippet': {'title': 'Synthetic', 'description': 'Synthetic description', 'channelId': 'owner'}, 'status': {'privacyStatus': 'public'}}], 'pageInfo': {'totalResults': 1}}
    elif url.endswith('playlistItems'):
        value = {'items': [{'id': 'item-1', 'snippet': {'position': 0, 'playlistId': 'PLsynthetic001', 'resourceId': {'kind': 'youtube#video', 'videoId': '00000000001'}}}], 'pageInfo': {'totalResults': 1}}
    else:
        raise AssertionError('Unexpected provider endpoint')
    return type('Response', (), {'content': True, 'status_code': 200, 'raise_for_status': lambda self: None, 'json': lambda self: value})()


requests.request = request
with patch('builtins.open', side_effect=AssertionError('File exchange forbidden')), \
     patch.object(Path, 'write_text', side_effect=AssertionError('File exchange forbidden')), \
     patch.object(Path, 'read_text', side_effect=AssertionError('File exchange forbidden')), \
     patch.object(Path, 'mkdir', side_effect=AssertionError('File exchange forbidden')):
    runpy.run_path(script, run_name='__main__')
