"""Existing-ID replacement with pre-call lease fencing and complete ordered read-back.
No automatic retries for append writes: ambiguous results restart from replacement.
"""
import json
import os
import re
import subprocess
import sys
import requests
from spotify_auth import auth_headers


def apply_plan(plan, request, guard):
    playlist_id = plan['playlist_id']
    uris = plan['track_uris']
    if not re.fullmatch(r'[A-Za-z0-9]{22}', playlist_id) or not uris or any(not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', uri) for uri in uris):
        raise ValueError('Invalid existing playlist plan')
    if plan['playlist_url'] != f'https://open.spotify.com/playlist/{playlist_id}' or plan['track_count'] != len(uris):
        raise ValueError('Playlist plan binding mismatch')
    endpoint = f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks'
    def read_back():
        result = []
        offset = 0
        while True:
            guard()
            page = request('GET', endpoint, params={'limit': 100, 'offset': offset})
            result.extend(item.get('track', {}).get('uri') for item in page['items'])
            if not page.get('next'):
                return result
            offset += len(page['items'])
            if not page['items'] or offset > 10000:
                raise ValueError('Unbounded playlist read-back')
    # A crash after success needs no further effects when desired content is present.
    if read_back() == uris:
        return
    for offset in range(0, len(uris), 100):
        guard()
        request('PUT' if offset == 0 else 'POST', endpoint, json={'uris': uris[offset:offset + 100]})
    if read_back() != uris:
        raise ValueError('Playlist read-back mismatch')


def main():
    plan = json.load(open(sys.argv[1], encoding='utf-8'))
    def guard():
        subprocess.run([os.environ['PLAYLIST_GUARD_NODE'], '--experimental-strip-types', os.environ['PLAYLIST_GUARD_SCRIPT']], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    def request(method, url, **kwargs):
        headers = auth_headers()
        guard()  # Token refresh may have waited; re-fence after obtaining headers.
        response = requests.request(method, url, headers=headers, timeout=30, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else {}
    apply_plan(plan, request, guard)

if __name__ == '__main__':
    main()
