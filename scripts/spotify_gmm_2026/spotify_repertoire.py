"""Reviewed live-act repertoire, independent from canonical artist identities."""
from __future__ import annotations

import re

API = 'https://api.spotify.com/v1'
ID = re.compile(r'^[A-Za-z0-9]{22}$')


def validate_profile(value):
    fields = {'schemaVersion', 'key', 'artistSlugs', 'setlistArtist', 'searchArtists',
              'anchorArtistIds', 'collaborationArtistIds', 'albumIds', 'sourceUrls'}
    if not isinstance(value, dict) or set(value) != fields or type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Invalid repertoire profile schema')
    def strings(key, minimum, maximum, pattern=None):
        items = value[key]
        if not isinstance(items, list) or not minimum <= len(items) <= maximum or any(
                not isinstance(x, str) or not x or (pattern and not pattern.fullmatch(x)) for x in items):
            raise ValueError('Invalid repertoire profile field')
        if len(set(items)) != len(items):
            raise ValueError('Duplicate repertoire values')
    if not isinstance(value['key'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9:-]{0,95}', value['key']):
        raise ValueError('Invalid repertoire key')
    if not isinstance(value['setlistArtist'], str) or not 1 <= len(value['setlistArtist'].strip()) <= 200:
        raise ValueError('Invalid repertoire setlist artist')
    strings('artistSlugs', 1, 20, re.compile(r'[a-z0-9][a-z0-9-]{0,199}'))
    for key, maximum in [('anchorArtistIds', 8), ('collaborationArtistIds', 8), ('albumIds', 24)]:
        strings(key, 1, maximum, ID)
    strings('sourceUrls', 1, 100)
    if any(not url.startswith('https://') for url in value['sourceUrls']):
        raise ValueError('Invalid repertoire evidence URL')
    artists = value['searchArtists']
    if not isinstance(artists, list) or not 2 <= len(artists) <= 8 or any(
            not isinstance(a, dict) or set(a) != {'id', 'name'} or not isinstance(a['id'], str) or
            not ID.fullmatch(a['id']) or not isinstance(a['name'], str) or not 1 <= len(a['name'].strip()) <= 200 for a in artists):
        raise ValueError('Invalid repertoire search identities')
    ids = {a['id'] for a in artists}
    if len(ids) != len(artists) or not set(value['anchorArtistIds'] + value['collaborationArtistIds']) <= ids or set(value['anchorArtistIds']) & set(value['collaborationArtistIds']):
        raise ValueError('Invalid repertoire identity roles')
    return value


def eligible_track(profile, track):
    """Solo anchors need a reviewed release; joint credits permit other releases."""
    credits = {a.get('id') for a in track.get('artists', [])}
    return bool(credits & set(profile['anchorArtistIds'])) and (
        track.get('album', {}).get('id') in profile['albumIds'] or
        bool(credits & set(profile['collaborationArtistIds'])))


def select_tracks(profile, recent_songs, get, canonical_key, short_track, version_penalty,
                  seen_uris, seen_songs, limit=5):
    """One budget across all identities; no broad-catalog fallback on failure."""
    validate_profile(profile)
    pool = {}
    def add(track):
        if not isinstance(track, dict) or not ID.fullmatch(str(track.get('id', ''))):
            return
        if not eligible_track(profile, track) or short_track(track) or version_penalty(track) >= 2 or track.get('is_playable') is False:
            return
        if track.get('uri') != 'spotify:track:' + track['id']:
            return
        old = pool.get(track['id'])
        if old is None or track.get('popularity', 0) > old.get('popularity', 0):
            pool[track['id']] = track

    # Top tracks alone can be dominated by other Slash projects. Read the
    # explicitly reviewed album tracklists as well, then hydrate full credits.
    for artist in profile['searchArtists']:
        for track in get(f"{API}/artists/{artist['id']}/top-tracks", {'market': 'DE'}).get('tracks', []):
            add(track)
    album_tracks = set()
    for album_id in profile['albumIds']:
        offset = 0
        while True:
            page = get(f'{API}/albums/{album_id}/tracks', {'limit': 50, 'offset': offset, 'market': 'DE'})
            items = page.get('items')
            if not isinstance(items, list) or len(items) > 50:
                raise ValueError('Invalid repertoire album tracks')
            for track in items:
                if isinstance(track, dict) and ID.fullmatch(str(track.get('id', ''))):
                    album_tracks.add(track['id'])
            if not page.get('next'):
                break
            offset += 50
            if offset >= 200:
                raise ValueError('Repertoire album tracklist exceeds bound')
    ids = sorted(album_tracks)
    for offset in range(0, len(ids), 50):
        requested = ids[offset:offset + 50]
        tracks = get(f'{API}/tracks', {'ids': ','.join(requested), 'market': 'DE'}).get('tracks')
        if not isinstance(tracks, list) or len(tracks) != len(requested):
            raise ValueError('Invalid repertoire track details')
        for track in tracks:
            if track is not None and track.get('id') not in requested:
                raise ValueError('Unexpected repertoire track identity')
            if track:
                add(track)

    # Search only missing recent titles, not the composite display string.
    ranked_songs = sorted(recent_songs.items(), key=lambda item: (-item[1], item[0].lower()))[:30]
    for song, _ in ranked_songs:
        target = canonical_key(song)
        if any(canonical_key(t['name']) == target for t in pool.values()):
            continue
        for artist in profile['searchArtists']:
            result = get(f'{API}/search', {'q': f"track:{song} artist:{artist['name']}", 'type': 'track', 'limit': 8, 'market': 'DE'})
            for track in result.get('tracks', {}).get('items', []):
                if canonical_key(track.get('name', '')) == target:
                    add(track)
    plays = {canonical_key(song): count for song, count in ranked_songs}
    def score(track):
        count = plays.get(canonical_key(track['name']), 0)
        return (not bool(count), -count, version_penalty(track), -track.get('popularity', 0), track['name'], track['id'])
    selected, log = [], []
    for track in sorted(pool.values(), key=score):
        song_key = canonical_key(track['name'])
        if track['uri'] in seen_uris or song_key in seen_songs:
            continue
        seen_uris.add(track['uri']); seen_songs.add(song_key)
        selected.append(track)
        log.append({'source': 'repertoire-setlist' if plays.get(song_key) else 'repertoire-fallback',
                    'profile': profile['key'], 'matched': track['name'], 'spotify_id': track['id'],
                    'credit_artist_ids': [a.get('id') for a in track['artists']], 'album_id': track.get('album', {}).get('id')})
        if len(selected) == limit:
            break
    return selected, log
