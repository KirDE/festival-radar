import argparse
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests
from festival_playlists import (
    canonical_track_key,
    is_feat_track,
    should_skip_track_for_artist,
    simplify_name,
    token_overlap,
    track_version_penalty,
)

DEFAULT_CREDENTIALS = Path('/home/openclaw/.openclaw/credentials/youtube-music.json')
DEFAULT_OAUTH = Path('/home/openclaw/.openclaw/credentials/youtube-music-oauth.json')
DEFAULT_CACHE = Path('tmp/festival_playlists_cache/youtube_music_search_cache.json')
DEFAULT_OUTPUT_DIR = Path('outputs/youtube_music')
SEARCH_CACHE_VERSION = 'ytm-transfer-v2'
# The default YouTube Data API project quota is commonly 10,000 units/day and
# each playlist insertion costs 50 units. Reserve half of that daily budget for
# metadata, read-back, retries, other playlists, and unrelated project traffic;
# resume mode will finish larger playlists across subsequent runs.
DEFAULT_MAX_NEW_ITEMS = 100
YOUTUBE_QUOTA_PLAYLIST_WRITE = 50
YOUTUBE_QUOTA_PLAYLIST_ITEM_WRITE = 50
YOUTUBE_QUOTA_PLAYLIST_ITEM_LIST = 1
YOUTUBE_VERSION_HINTS = {
    'club',
    'demo',
    'dub',
    'english',
    'medieval techno',
    'mix',
    'rework',
    'sample',
}
DATA_API_REASON_PATTERN = re.compile(r'[^a-z0-9]+')


class YouTubeDataApiError(RuntimeError):
    def __init__(self, status_code: int, reason: str = 'unknown'):
        normalized_reason = DATA_API_REASON_PATTERN.sub('_', str(reason).casefold()).strip('_') or 'unknown'
        self.status_code = status_code
        self.reason = normalized_reason
        super().__init__(f'YouTube Data API failure: status={status_code} reason={normalized_reason}')


def raise_youtube_data_api_error(response, data: dict) -> None:
    error = data.get('error', {}) if isinstance(data, dict) else {}
    details = error.get('errors', []) if isinstance(error, dict) else []
    reason = details[0].get('reason') if details and isinstance(details[0], dict) else 'unknown'
    raise YouTubeDataApiError(response.status_code, reason)


def parse_report_tracks(report: dict) -> list[dict]:
    tracks = []
    seen = set()
    for entry in report.get('report', []):
        lineup_artist = entry.get('artist') or entry.get('query_artist') or ''
        query_artist = entry.get('query_artist') or lineup_artist
        for label in entry.get('tracks', []):
            if ' - ' not in label:
                continue
            artist, title = label.split(' - ', 1)
            key = (simplify_name(artist), canonical_track_key(title))
            if key in seen:
                continue
            seen.add(key)
            tracks.append({
                'lineup_artist': lineup_artist,
                'query_artist': query_artist,
                'artist': artist,
                'title': title,
                'label': label,
            })
    return tracks


def youtube_candidate_to_track(candidate: dict) -> dict:
    return {
        'name': candidate.get('title') or '',
        'artists': [{'name': artist.get('name') or ''} for artist in candidate.get('artists', [])],
        'duration_ms': int(candidate.get('duration_seconds') or 0) * 1000,
    }


def version_hint_text(text: str) -> str:
    lowered = unicodedata.normalize('NFKD', text.lower()).encode('ascii', 'ignore').decode('ascii')
    lowered = re.sub(r'[^a-z0-9]+', ' ', lowered)
    return ' '.join(lowered.split())


def youtube_version_penalty(query_title: str, candidate_title: str) -> int:
    query_key = version_hint_text(query_title)
    title_key = version_hint_text(candidate_title)
    return sum(1 for hint in YOUTUBE_VERSION_HINTS if hint in title_key and hint not in query_key)


def youtube_candidate_score(query: dict, candidate: dict) -> tuple | None:
    video_id = candidate.get('videoId')
    if not video_id:
        return None

    track = youtube_candidate_to_track(candidate)
    skip_reason = should_skip_track_for_artist(query['query_artist'], track, query['lineup_artist'])
    if skip_reason:
        return None
    if youtube_version_penalty(query['title'], candidate.get('title') or '') > 0:
        return None

    artist_names = [artist['name'] for artist in track.get('artists', []) if artist.get('name')]
    artist_score = max(token_overlap(query['artist'], artist) for artist in artist_names) if artist_names else 0.0
    if simplify_name(query['artist']) in [simplify_name(artist) for artist in artist_names]:
        artist_score += 1.0

    target_key = canonical_track_key(query['title'])
    title_key = canonical_track_key(candidate.get('title') or '')
    title_score = 1.0 if title_key == target_key else token_overlap(query['title'], candidate.get('title') or '')
    if title_score < 0.45:
        return None

    return (
        artist_score,
        title_score,
        candidate.get('resultType') == 'song',
        not is_feat_track(track),
        -track_version_penalty(track),
        int(candidate.get('duration_seconds') or 0),
    )


def load_json(path: Path, default):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def load_ytmusic():
    from ytmusicapi import YTMusic

    # Search is a public YouTube Music operation. The OAuth token used for
    # playlist writes is intentionally scoped to the YouTube Data API and can
    # be rejected by YouTube Music's private search endpoint. Keep discovery
    # unauthenticated and use the protected OAuth files only in the explicit
    # Data API write/read-back helpers below.
    return YTMusic()


def youtube_data_api_headers(credentials_path: Path, oauth_path: Path) -> dict[str, str]:
    from ytmusicapi.auth.oauth.credentials import OAuthCredentials

    credentials = load_json(credentials_path, {})
    token_path = Path(oauth_path)
    token = load_json(token_path, {})
    if token.get('expires_at', 0) - int(time.time()) < 60:
        oauth_credentials = OAuthCredentials(credentials['client_id'], credentials['client_secret'])
        fresh = oauth_credentials.refresh_token(token['refresh_token'])
        token.update({
            'access_token': fresh['access_token'],
            'expires_at': int(time.time()) + fresh['expires_in'],
            'expires_in': fresh['expires_in'],
        })
        save_json(token_path, token)
        token_path.chmod(0o600)
    return {
        'Authorization': f"Bearer {token['access_token']}",
        'Accept': 'application/json',
    }


def youtube_data_api_request(method: str, url: str, *, headers: dict[str, str], params: dict, body: dict) -> dict:
    response = requests.request(method, url, params=params, headers=headers, json=body, timeout=30)
    data = response.json()
    if response.status_code >= 400:
        raise_youtube_data_api_error(response, data)
    return data


def create_youtube_playlist(credentials_path: Path, oauth_path: Path, title: str, description: str) -> str:
    data = youtube_data_api_request(
        'POST',
        'https://www.googleapis.com/youtube/v3/playlists',
        headers=youtube_data_api_headers(credentials_path, oauth_path),
        params={'part': 'snippet,status'},
        body={
            'snippet': {'title': title, 'description': description},
            'status': {'privacyStatus': 'public'},
        },
    )
    return data['id']


def update_youtube_playlist(credentials_path: Path, oauth_path: Path, playlist_id: str, title: str, description: str) -> None:
    youtube_data_api_request(
        'PUT',
        'https://www.googleapis.com/youtube/v3/playlists',
        headers=youtube_data_api_headers(credentials_path, oauth_path),
        params={'part': 'snippet,status'},
        body={
            'id': playlist_id,
            'snippet': {'title': title, 'description': description},
            'status': {'privacyStatus': 'public'},
        },
    )


def list_youtube_playlist_items(credentials_path: Path, oauth_path: Path, playlist_id: str) -> list[dict]:
    headers = youtube_data_api_headers(credentials_path, oauth_path)
    items = []
    page_token = ''
    while True:
        params = {
            'part': 'id,snippet',
            'playlistId': playlist_id,
            'maxResults': 50,
        }
        if page_token:
            params['pageToken'] = page_token
        response = requests.get(
            'https://www.googleapis.com/youtube/v3/playlistItems',
            params=params,
            headers=headers,
            timeout=30,
        )
        data = response.json()
        if response.status_code >= 400:
            raise_youtube_data_api_error(response, data)
        items.extend(data.get('items', []))
        page_token = data.get('nextPageToken') or ''
        if not page_token:
            return items


def delete_youtube_playlist_item(credentials_path: Path, oauth_path: Path, item_id: str) -> None:
    response = requests.delete(
        'https://www.googleapis.com/youtube/v3/playlistItems',
        params={'id': item_id},
        headers=youtube_data_api_headers(credentials_path, oauth_path),
        timeout=30,
    )
    if response.status_code not in (200, 204):
        data = response.json()
        raise_youtube_data_api_error(response, data)


def add_youtube_playlist_item(credentials_path: Path, oauth_path: Path, playlist_id: str, video_id: str, position: int) -> None:
    youtube_data_api_request(
        'POST',
        'https://www.googleapis.com/youtube/v3/playlistItems',
        headers=youtube_data_api_headers(credentials_path, oauth_path),
        params={'part': 'snippet'},
        body={
            'snippet': {
                'playlistId': playlist_id,
                'position': position,
                'resourceId': {'kind': 'youtube#video', 'videoId': video_id},
            },
        },
    )


def sync_youtube_playlist_items(
    credentials_path: Path,
    oauth_path: Path,
    playlist_id: str,
    video_ids: list[str],
    *,
    resume: bool,
    max_new_items: int | None,
) -> dict:
    current = list_youtube_playlist_items(credentials_path, oauth_path, playlist_id)
    list_page_count = max(1, (len(current) + 49) // 50)
    existing_video_ids = [
        item.get('snippet', {}).get('resourceId', {}).get('videoId')
        for item in current
        if item.get('snippet', {}).get('resourceId', {}).get('videoId')
    ]
    existing_video_id_set = set(existing_video_ids)
    deleted_count = 0
    if resume:
        queued = [video_id for video_id in video_ids if video_id not in existing_video_id_set]
        start_position = len(existing_video_ids)
    else:
        for item in current:
            delete_youtube_playlist_item(credentials_path, oauth_path, item['id'])
            deleted_count += 1
        queued = video_ids
        start_position = 0

    total_queued = len(queued)
    if max_new_items is not None:
        queued = queued[:max_new_items]

    for index, video_id in enumerate(queued, start_position):
        add_youtube_playlist_item(credentials_path, oauth_path, playlist_id, video_id, index)

    return {
        'existing_count': len(existing_video_ids),
        'deleted_count': deleted_count,
        'queued_count': total_queued,
        'inserted_count': len(queued),
        'remaining_count': total_queued - len(queued),
        'estimated_read_quota_units': list_page_count * YOUTUBE_QUOTA_PLAYLIST_ITEM_LIST,
        'estimated_write_quota_units': (
            deleted_count * YOUTUBE_QUOTA_PLAYLIST_ITEM_WRITE
            + len(queued) * YOUTUBE_QUOTA_PLAYLIST_ITEM_WRITE
        ),
    }


def read_back_youtube_playlist(
    credentials_path: Path,
    oauth_path: Path,
    playlist_id: str,
    expected_title: str,
    expected_description: str,
    expected_video_ids: list[str],
) -> dict:
    data = youtube_data_api_request(
        'GET',
        'https://www.googleapis.com/youtube/v3/playlists',
        headers=youtube_data_api_headers(credentials_path, oauth_path),
        params={'part': 'snippet,status', 'id': playlist_id},
        body={},
    )
    playlists = data.get('items', [])
    if len(playlists) != 1 or playlists[0].get('id') != playlist_id:
        raise RuntimeError('YouTube playlist read-back failed: persisted playlist id was not returned')
    snippet = playlists[0].get('snippet', {})
    if snippet.get('title') != expected_title or snippet.get('description') != expected_description:
        raise RuntimeError('YouTube playlist read-back failed: persisted metadata does not match')

    items = list_youtube_playlist_items(credentials_path, oauth_path, playlist_id)
    video_ids = [
        item.get('snippet', {}).get('resourceId', {}).get('videoId')
        for item in items
        if item.get('snippet', {}).get('resourceId', {}).get('videoId')
    ]
    if not video_ids:
        raise RuntimeError('YouTube playlist read-back failed: persisted track set is empty')
    if len(video_ids) != len(set(video_ids)):
        raise RuntimeError('YouTube playlist read-back failed: persisted track set contains duplicates')
    expected_set = set(expected_video_ids)
    if expected_set and not expected_set.intersection(video_ids):
        raise RuntimeError('YouTube playlist read-back failed: no requested tracks were persisted')
    return {
        'playlist_id': playlist_id,
        'metadata_matches': True,
        'track_count': len(video_ids),
        'unique_track_count': len(set(video_ids)),
        'requested_tracks_present': len(expected_set.intersection(video_ids)),
    }


def classify_search_exception(exc: Exception) -> str:
    response = getattr(exc, 'response', None)
    status_code = getattr(response, 'status_code', None)
    normalized = str(exc).casefold()
    if status_code == 429 or 'quota' in normalized or 'rate limit' in normalized:
        return 'quota'
    if status_code in (401, 403) or any(marker in normalized for marker in ('auth', 'unauthorized', 'invalid_grant', 'access token')):
        return 'authentication'
    return 'provider'


def search_youtube_track(ytmusic, query: dict, cache: dict, *, pause_seconds: float = 0.0, stats: dict | None = None) -> dict | None:
    stats = stats if stats is not None else {}
    stats['queries'] = stats.get('queries', 0) + 1
    cache_key = f"{SEARCH_CACHE_VERSION}:{query['artist']} - {query['title']}"
    cached = cache.get(cache_key)
    if cached is not None:
        stats['cache_hits'] = stats.get('cache_hits', 0) + 1
        return cached or None

    results = []
    for search_filter in ('songs', 'videos'):
        try:
            results.extend(ytmusic.search(f"{query['artist']} {query['title']}", filter=search_filter, limit=10))
        except Exception as exc:
            category = classify_search_exception(exc)
            key = f'{category}_errors'
            stats[key] = stats.get(key, 0) + 1
            continue
        if results:
            break
    if not results:
        stats['empty_results'] = stats.get('empty_results', 0) + 1
        return None

    best = None
    best_score = None
    seen_video_ids = set()
    for candidate in results:
        video_id = candidate.get('videoId')
        if not video_id or video_id in seen_video_ids:
            continue
        seen_video_ids.add(video_id)
        score = youtube_candidate_score(query, candidate)
        if score is None:
            continue
        if best_score is None or score > best_score:
            best_score = score
            best = candidate

    cache[cache_key] = best or {}
    if best is None:
        stats['rejected_results'] = stats.get('rejected_results', 0) + 1
    else:
        stats['matched'] = stats.get('matched', 0) + 1
    if pause_seconds:
        time.sleep(pause_seconds)
    return best


def replace_playlist_items(ytmusic, playlist_id: str, video_ids: list[str]) -> None:
    current = ytmusic.get_playlist(playlist_id, limit=None).get('tracks', [])
    removable = [
        {'videoId': item.get('videoId'), 'setVideoId': item.get('setVideoId')}
        for item in current
        if item.get('videoId') and item.get('setVideoId')
    ]
    for idx in range(0, len(removable), 100):
        ytmusic.remove_playlist_items(playlist_id, removable[idx:idx + 100])
    for idx in range(0, len(video_ids), 100):
        ytmusic.add_playlist_items(playlist_id, video_ids[idx:idx + 100], duplicates=False)


def publish_playlist(
    source_report: dict,
    video_ids: list[str],
    playlist_id: str | None,
    credentials_path: Path,
    oauth_path: Path,
    *,
    resume: bool,
    update_metadata: bool,
    max_new_items: int | None,
) -> tuple[str, str, dict]:
    if not video_ids:
        raise RuntimeError('YouTube publishing aborted: no matched tracks')
    title = source_report['playlist_name']
    festival = source_report.get('festival') or title
    description = f'Listen to the announced artists for {festival}. Generated by Festival Radar.'
    metadata_quota_units = 0
    if playlist_id:
        if update_metadata:
            update_youtube_playlist(credentials_path, oauth_path, playlist_id, title, description)
            metadata_quota_units = YOUTUBE_QUOTA_PLAYLIST_WRITE
    else:
        playlist_id = create_youtube_playlist(credentials_path, oauth_path, title, description)
        metadata_quota_units = YOUTUBE_QUOTA_PLAYLIST_WRITE
    publish_summary = sync_youtube_playlist_items(
        credentials_path,
        oauth_path,
        playlist_id,
        video_ids,
        resume=resume,
        max_new_items=max_new_items,
    )
    publish_summary['metadata_quota_units'] = metadata_quota_units
    publish_summary['estimated_total_write_quota_units'] = (
        metadata_quota_units + publish_summary['estimated_write_quota_units']
    )
    publish_summary['estimated_total_quota_units'] = (
        publish_summary['estimated_total_write_quota_units']
        + publish_summary['estimated_read_quota_units']
    )
    publish_summary['read_back'] = read_back_youtube_playlist(
        credentials_path,
        oauth_path,
        playlist_id,
        title,
        description,
        video_ids,
    )
    return playlist_id, f'https://music.youtube.com/playlist?list={playlist_id}', publish_summary


def build_youtube_report(source_report: dict, source_tracks: list[dict], matched: list[dict], missing: list[dict], playlist_id: str = '', playlist_url: str = '') -> dict:
    seen_video_ids = set()
    duplicate_video_ids = []
    seen_song_keys = set()
    duplicate_song_keys = []
    for item in matched:
        video_id = item['videoId']
        if video_id in seen_video_ids:
            duplicate_video_ids.append(video_id)
        seen_video_ids.add(video_id)
        song_key = canonical_track_key(item['title'])
        if song_key in seen_song_keys:
            duplicate_song_keys.append(item['label'])
        seen_song_keys.add(song_key)

    return {
        'festival': source_report.get('festival'),
        'slug': source_report.get('slug'),
        'playlist_name': source_report.get('playlist_name'),
        'source_playlist_url': source_report.get('playlist_url'),
        'playlist_id': playlist_id,
        'playlist_url': playlist_url,
        'artists_count': len({simplify_name(item.get('lineup_artist') or item.get('artist') or '') for item in matched if item.get('lineup_artist') or item.get('artist')}),
        'track_count': len(matched),
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'source_track_count': len(source_tracks),
        'matched_track_count': len(matched),
        'missing_track_count': len(missing),
        'duplicate_video_ids': duplicate_video_ids,
        'duplicate_song_keys': duplicate_song_keys,
        'matched': matched,
        'missing': missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Transfer a festival playlist report to YouTube Music.')
    parser.add_argument('--report', default='outputs/festival_playlists/summer_breeze_2026.json')
    parser.add_argument('--output', default=str(DEFAULT_OUTPUT_DIR / 'summer_breeze_2026.json'))
    parser.add_argument('--cache', default=str(DEFAULT_CACHE))
    parser.add_argument('--credentials', default=str(DEFAULT_CREDENTIALS))
    parser.add_argument('--oauth', default=str(DEFAULT_OAUTH))
    parser.add_argument('--playlist-id', default=os.environ.get('YOUTUBE_MUSIC_PLAYLIST_ID', ''))
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--resume-publish', action='store_true')
    parser.add_argument('--update-metadata', action='store_true')
    parser.add_argument(
        '--max-new-items',
        type=int,
        default=int(os.environ.get('YOUTUBE_MUSIC_MAX_NEW_ITEMS', DEFAULT_MAX_NEW_ITEMS)),
        help='Maximum new playlist items to insert in this run. Use -1 to disable the safety cap.',
    )
    parser.add_argument('--pause-seconds', type=float, default=0.0)
    args = parser.parse_args()

    report_path = Path(args.report)
    source_report = load_json(report_path, {})
    source_tracks = parse_report_tracks(source_report)
    if not source_tracks:
        raise RuntimeError(f'no tracks found in report: {report_path}')

    ytmusic = load_ytmusic()
    cache_path = Path(args.cache)
    cache = load_json(cache_path, {})
    matched = []
    missing = []
    used_video_ids = set()
    search_stats = {}

    for index, query in enumerate(source_tracks, 1):
        candidate = search_youtube_track(ytmusic, query, cache, pause_seconds=args.pause_seconds, stats=search_stats)
        if not candidate:
            missing.append(query)
            print(f"[{index}/{len(source_tracks)}] missing: {query['label']}")
            continue
        video_id = candidate['videoId']
        if video_id in used_video_ids:
            missing.append({**query, 'reason': 'duplicate_video_id', 'videoId': video_id})
            print(f"[{index}/{len(source_tracks)}] duplicate video: {query['label']}")
            continue
        used_video_ids.add(video_id)
        matched.append({
            **query,
            'youtube_title': candidate.get('title'),
            'youtube_artists': [artist.get('name') for artist in candidate.get('artists', [])],
            'duration_seconds': candidate.get('duration_seconds'),
            'videoId': video_id,
            'youtube_url': f'https://music.youtube.com/watch?v={video_id}',
        })
        print(f"[{index}/{len(source_tracks)}] matched: {query['label']} -> {candidate.get('title')}")
        if index % 25 == 0:
            save_json(cache_path, cache)

    save_json(cache_path, cache)

    playlist_id = ''
    playlist_url = ''
    publish_summary = {}
    if args.publish:
        if not matched:
            if search_stats.get('authentication_errors'):
                raise RuntimeError('YouTube search authentication failure; no matched tracks')
            if search_stats.get('quota_errors'):
                raise RuntimeError('YouTube search quota failure; no matched tracks')
            if search_stats.get('provider_errors'):
                raise RuntimeError('YouTube search provider failure; no matched tracks')
            if search_stats.get('empty_results'):
                raise RuntimeError('YouTube search returned no candidates; no matched tracks')
            raise RuntimeError('YouTube search rejected all candidates; no matched tracks')
        max_new_items = None if args.max_new_items < 0 else args.max_new_items
        playlist_id, playlist_url, publish_summary = publish_playlist(
            source_report,
            [item['videoId'] for item in matched],
            args.playlist_id or None,
            Path(args.credentials),
            Path(args.oauth),
            resume=args.resume_publish,
            update_metadata=args.update_metadata,
            max_new_items=max_new_items,
        )

    output = build_youtube_report(source_report, source_tracks, matched, missing, playlist_id, playlist_url)
    if publish_summary:
        output['publish_summary'] = publish_summary
    output['search_summary'] = search_stats
    save_json(Path(args.output), output)
    summary = {
        'output': args.output,
        'playlist_url': playlist_url,
        'source_track_count': output['source_track_count'],
        'matched_track_count': output['matched_track_count'],
        'missing_track_count': output['missing_track_count'],
        'duplicate_video_ids': len(output['duplicate_video_ids']),
        'duplicate_song_keys': len(output['duplicate_song_keys']),
    }
    if publish_summary:
        summary['publish_summary'] = publish_summary
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
