"""Durable creation and replacement with fencing and complete ordered read-back.
No automatic retries for append writes: ambiguous results restart from replacement.
"""
import json
import os
import re
import subprocess
import sys
import requests
from spotify_auth import auth_headers


def validate_tracks(plan):
    uris = plan['track_uris']
    if not uris or any(not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', uri) for uri in uris) or plan['track_count'] != len(uris):
        raise ValueError('Invalid playlist tracks')


def ensure_playlist(plan, request, guard, creation_state):
    """Never repeat a create request whose outcome may be unknown.

    The exact description marker survives response/ID-persistence loss. Discovery
    must find exactly one owned playlist; zero matches blocks for reconciliation.
    """
    validate_tracks(plan)
    if plan.get('playlist_url'):
        return
    state = creation_state('read')
    marker = state['marker']
    description = f'[{marker}]'
    guard()
    owner = request('GET', 'https://api.spotify.com/v1/me')['id']
    playlist_id = state['playlistId']
    if not playlist_id and state['sent']:
        matches = []
        offset = 0
        while True:
            guard()
            page = request('GET', 'https://api.spotify.com/v1/me/playlists', params={'limit': 50, 'offset': offset})
            matches.extend(item['id'] for item in page['items'] if item.get('description') == description and item.get('owner', {}).get('id') == owner)
            if not page.get('next'):
                break
            offset += len(page['items'])
            if not page['items'] or offset > 10000:
                raise ValueError('Unbounded creation discovery')
        if len(matches) != 1:
            raise RuntimeError('Unknown creation outcome; reconciliation required (no create retry)')
        playlist_id = matches[0]
    if not playlist_id:
        name = plan.get('playlist_name')
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Playlist name required')
        creation_state('reserve')  # Durable before POST, even if guard then fails.
        guard()
        created = request('POST', 'https://api.spotify.com/v1/me/playlists', json={'name': name, 'description': description, 'public': True})
        playlist_id = created['id']
    if not re.fullmatch(r'[A-Za-z0-9]{22}', playlist_id):
        raise ValueError('Invalid created playlist ID')
    guard()
    metadata = request('GET', f'https://api.spotify.com/v1/playlists/{playlist_id}')
    if metadata.get('id') != playlist_id or metadata.get('owner', {}).get('id') != owner or metadata.get('description') != description:
        raise ValueError('Creation read-back mismatch')
    creation_state('bind', playlist_id)
    plan['playlist_id'] = playlist_id
    plan['playlist_url'] = f'https://open.spotify.com/playlist/{playlist_id}'


def apply_plan(plan, request, guard):
    validate_tracks(plan)
    playlist_id = plan['playlist_id']
    uris = plan['track_uris']
    if not re.fullmatch(r'[A-Za-z0-9]{22}', playlist_id) or not uris or any(not re.fullmatch(r'spotify:track:[A-Za-z0-9]{22}', uri) for uri in uris):
        raise ValueError('Invalid existing playlist plan')
    if plan['playlist_url'] != f'https://open.spotify.com/playlist/{playlist_id}' or plan['track_count'] != len(uris):
        raise ValueError('Playlist plan binding mismatch')
    endpoint = f'https://api.spotify.com/v1/playlists/{playlist_id}/items'
    def read_back():
        result = []
        offset = 0
        while True:
            guard()
            page = request('GET', endpoint, params={'limit': 100, 'offset': offset})
            result.extend((item.get('item') or item.get('track') or {}).get('uri') for item in page['items'])
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
    def creation_state(action, playlist_id=None):
        args = [os.environ['PLAYLIST_GUARD_NODE'], '--experimental-strip-types', os.environ['PLAYLIST_GUARD_SCRIPT'], action]
        if playlist_id:
            args.append(playlist_id)
        result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=20)
        return json.loads(result.stdout)
    def request(method, url, **kwargs):
        headers = auth_headers()
        guard()  # Token refresh may have waited; re-fence after obtaining headers.
        response = requests.request(method, url, headers=headers, timeout=30, **kwargs)
        response.raise_for_status()
        return response.json() if response.content else {}
    ensure_playlist(plan, request, guard, creation_state)
    apply_plan(plan, request, guard)
    guard()
    with open(sys.argv[1], 'w', encoding='utf-8') as output:
        json.dump(plan, output)

if __name__ == '__main__':
    main()
