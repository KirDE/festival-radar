import json
import os
import re
import time
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timedelta
from html import unescape
from pathlib import Path
from typing import Callable

import requests

from spotify_auth import auth_headers

SETLIST_API_KEY = os.environ.get('SETLIST_API_KEY')
REPORT_DIR = Path('outputs/festival_playlists')
REPORT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR = Path('tmp/festival_playlists_cache')
CACHE_DIR.mkdir(parents=True, exist_ok=True)
SETLIST_CACHE_FILE = CACHE_DIR / 'setlist_cache.json'
CACHE_ONLY_SETLIST = os.environ.get('FESTIVAL_SETLIST_CACHE_ONLY') == '1'
REPORT_ONLY = os.environ.get('FESTIVAL_REPORT_ONLY') == '1'

SETLIST_HEADERS = {
    'Accept': 'application/json',
    'User-Agent': 'Clawdbie-Festival-Playlists/1.1',
}
if SETLIST_API_KEY:
    SETLIST_HEADERS['x-api-key'] = SETLIST_API_KEY
RATE_LIMIT_SECONDS = 1.05
SETLIST_RETRY_CODES = {429, 500, 502, 503, 504}
MAX_RETRY_AFTER_SECONDS = float(os.environ.get('FESTIVAL_MAX_RETRY_AFTER_SECONDS', '60'))
_last_setlist_call = 0.0

GLOBAL_EXCLUDES = {
    'DJ Carl', 'DJ Nathachelet', 'VJ Set', 'AmÆzing Snäke', 'Deaftones', 'Chop Suey',
    'Korn Again', 'Powerslave', 'Ultimate Ozzy', 'Slip-NOT', 'Thrash Attack', 'Rock The Fox',
    'Pablo Honey', 'Snaggletooth', "St. Jimmy's", 'Spouky Kids', 'DJ Curo', 'DJ Crash',
    'NIN UK', 'ROLR'
}
KEYWORDS_EXCLUDE = ['dj ', ' karaoke', ' tribute', ' cover band', ' aftershow', ' party set']
TRIBUTE_NAME_HINTS = {'again', 'not', 'ozzy', 'pistols', 'attack'}
FOLLOWERS_CACHE = {}
ARTIST_SEARCH_CACHE = {}
MBID_CACHE = {}
SETLIST_CACHE = {}
TRACK_SEARCH_CACHE = {}
PERSISTENT_SETLIST_CACHE = json.loads(SETLIST_CACHE_FILE.read_text(encoding='utf-8')) if SETLIST_CACHE_FILE.exists() else {}
PERSISTENT_MBID_CACHE = {}
MIN_TRACK_MS = 90_000
NON_SONG_TITLE_HINTS = {'intro', 'outro', 'interlude', 'overture'}
BAD_VERSION_DESCRIPTOR_HINTS = {
    'karaoke', 'orchestral', 'piano', 'queen alien', 'saltatio mortis', 'unplugged',
}
STRICT_ARTIST_ONLY_FALLBACK = {'Tom Morello'}
LIVE_REPERTOIRE_PRIMARY_ARTISTS = {
    'Tom Morello': {'Tom Morello', 'Rage Against The Machine', 'Audioslave', 'Prophets Of Rage'},
}
BLOCKED_PRIMARY_ARTIST_PREFIXES = {'of'}
BLOCKED_PRIMARY_ARTIST_MATCHES = {
    'Phantom': {'Phantom Planet'},
}
RECENT_SETLIST_DAYS = 365
FEATURE_CLAUSE_RE = re.compile(r'(?:[-(\[]\s*)?\b(feat|featuring|ft)\b.*$', re.I)
GRASPOP_DAYS = ('thursday', 'friday', 'saturday', 'sunday')
ROCK_IM_PARK_2026_HEADLINERS = [
    'Bad Omens', 'Volbeat', 'Electric Callboy', 'Ice Nine Kills',
    'Landmvrks', 'Marteria', 'Three Days Grace', 'Tom Morello',
]
ROCK_IM_PARK_2026_ARTISTS = [
    'Bad Omens', 'Volbeat', 'Electric Callboy', 'Ice Nine Kills', 'Landmvrks',
    'Marteria', 'Three Days Grace', 'Tom Morello', 'Linkin Park', 'Iron Maiden',
    'Limp Bizkit', 'The Offspring', 'Papa Roach', 'Breaking Benjamin', 'Babymetal',
    'Hollywood Undead', 'Sabaton', 'Bush', 'A Perfect Circle', 'Black Veil Brides',
    'Trivium', 'The Pretty Reckless', 'Within Temptation', 'Architects', 'Alter Bridge',
    'Set It Off', 'Mastodon', 'We Came As Romans', 'The Hives', 'Palaye Royale',
    'Social Distortion', 'The Plot In You', 'Finch', 'Loathe', 'The Story So Far',
    'Basement', 'TX2', 'Magnolia Park', 'Kublai Khan TX', 'Bloodywood', 'TesseracT',
    'Bury Tomorrow', 'Paleface Swiss', 'Catch Your Breath', 'Bilmuri', 'Don Broco',
    'Thornhill', 'President', 'The Subways', 'Danko Jones', 'Blood Incantation',
    'Ecca Vandal', 'Wargasm', 'DRAIN', 'Malevolence', 'Dying Wish',
    'The Funeral Portrait', 'Boundaries', 'Gatecreeper', 'Letlive.', 'Mehnersmoos',
    'Bad Nerves', 'Ankor', 'Sondaschule', 'H-Blockx', 'Return to Dust', 'High Vis',
    'The Butcher Sisters', 'Ego Kill Talent', 'Anna Grey', 'Slay Squad', 'Max Grimm',
    'Mouth Culture',
]


@dataclass
class Festival:
    key: str
    display_name: str
    playlist_name: str
    description: str
    lineup_fn: Callable[[], tuple[list[str], list[str]]]
    existing_playlist_id: str | None = None
    aliases: dict[str, str] | None = None
    spotify_artist_ids: dict[str, str] | None = None
    mbids: dict[str, str] | None = None
    extra_excludes: set[str] | None = None


def load_report_mbid_cache(report_dir: Path) -> dict[str, str]:
    cache = {}
    for path in report_dir.glob('*.json'):
        try:
            report = json.loads(path.read_text(encoding='utf-8')).get('report', [])
        except (OSError, json.JSONDecodeError):
            continue
        for entry in report:
            mbid = entry.get('mbid')
            if not mbid:
                continue
            for key in (entry.get('query_artist'), entry.get('artist')):
                if key and key not in cache:
                    cache[key] = mbid
    return cache


PERSISTENT_MBID_CACHE.update(load_report_mbid_cache(REPORT_DIR))


def sl_get(url, params=None, retries=4):
    require_setlist_api_key()
    global _last_setlist_call
    params = params or {}
    attempt = 0
    while True:
        elapsed = time.time() - _last_setlist_call
        if elapsed < RATE_LIMIT_SECONDS:
            time.sleep(RATE_LIMIT_SECONDS - elapsed)
        response = requests.get(url, headers=SETLIST_HEADERS, params=params, timeout=30)
        _last_setlist_call = time.time()
        if response.status_code in SETLIST_RETRY_CODES and attempt < retries:
            wait = retry_wait_seconds(response, max(5, 2 ** attempt))
            time.sleep(max(wait, RATE_LIMIT_SECONDS))
            attempt += 1
            continue
        response.raise_for_status()
        return response.json()


def require_setlist_api_key():
    if not SETLIST_API_KEY:
        raise RuntimeError('SETLIST_API_KEY is required to fetch live setlist.fm data before regenerating festival playlists')


def retry_wait_seconds(response, fallback: float) -> float:
    retry_after = response.headers.get('Retry-After')
    try:
        wait = float(retry_after) if retry_after else fallback
    except ValueError:
        wait = fallback
    return min(wait, MAX_RETRY_AFTER_SECONDS)


def selected_artist_keys() -> set[str]:
    selected = os.environ.get('FESTIVAL_ARTISTS', '')
    return {simplify_name(item.strip()) for item in selected.split(',') if item.strip()}


def artist_matches_selected(name: str, query_name: str, selected_keys: set[str]) -> bool:
    return simplify_name(name) in selected_keys or simplify_name(query_name) in selected_keys


def _spotify_request(method, url, *, params=None, payload=None, retries=6):
    for attempt in range(retries + 1):
        headers = auth_headers()
        if payload is not None:
            headers = {**headers, 'Content-Type': 'application/json'}
        try:
            response = requests.request(method, url, headers=headers, params=params, json=payload, timeout=30)
        except requests.exceptions.RequestException:
            if attempt < retries:
                time.sleep(max(5, 2 ** attempt))
                continue
            raise
        if response.status_code == 401 and attempt < retries:
            time.sleep(1)
            continue
        if response.status_code in {500, 502, 503, 504, 429}:
            if attempt < retries:
                wait = retry_wait_seconds(response, max(10, 2 ** attempt))
                time.sleep(wait)
                continue
            else:
                # If we exhausted retries on 5xx, we might be hitting a persistent Spotify outage.
                # Just raise, it will crash the script.
                pass
        response.raise_for_status()
        return response
    response.raise_for_status()
    return response


def spotify_get(url, params=None):
    response = _spotify_request('GET', url, params=params)
    return response.json()


def spotify_post(url, payload):
    response = _spotify_request('POST', url, payload=payload)
    return response.json() if response.text else {}


def spotify_put(url, payload):
    response = _spotify_request('PUT', url, payload=payload)
    return response.json() if response.text else {}


def update_playlist_details(playlist_id, name, description):
    spotify_put(f'https://api.spotify.com/v1/playlists/{playlist_id}', {'name': name, 'description': description, 'public': True})


def clean_name(text: str) -> str:
    text = unescape(text)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = ' '.join(text.split())
    text = re.sub(r'^(first time\s+)', '', text, flags=re.I)
    text = re.sub(r'\s+Multiple Performances.*$', '', text, flags=re.I)
    text = re.sub(r'\s+(Thursday|Friday|Saturday|Sunday|Monday)\s+•.*$', '', text, flags=re.I)
    return text.strip(' •-')


def simplify_name(name: str) -> str:
    lowered = name.lower()
    lowered = unescape(lowered)
    lowered = lowered.translate(str.maketrans({'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'å': 'a', 'ö': 'o', 'ä': 'a', 'ü': 'u'}))
    lowered = unicodedata.normalize('NFKD', lowered).encode('ascii', 'ignore').decode('ascii')
    lowered = lowered.replace('&', ' and ')
    lowered = re.sub(r'\([^)]*\)', ' ', lowered)
    lowered = re.sub(r'\[[^\]]*\]', ' ', lowered)
    lowered = re.sub(r'[^a-z0-9]+', ' ', lowered)
    lowered = re.sub(r'\b(the|a|an|of|and|feat|featuring|with|official|band|chaos|ad)\b', ' ', lowered)
    return ' '.join(lowered.split())


def token_overlap(a: str, b: str) -> float:
    sa = set(simplify_name(a).split())
    sb = set(simplify_name(b).split())
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa), len(sb))


def setlist_lookup_name(name: str) -> str:
    return FEATURE_CLAUSE_RE.sub('', name).strip() or name


def looks_like_tribute(name: str) -> bool:
    lowered = name.lower()
    if any(keyword in lowered for keyword in KEYWORDS_EXCLUDE):
        return True
    tokens = set(simplify_name(name).split())
    return any(token in tokens for token in TRIBUTE_NAME_HINTS if len(tokens) <= 3)


def should_exclude(name: str, festival: Festival) -> bool:
    if name in GLOBAL_EXCLUDES:
        return True
    if festival.extra_excludes and name in festival.extra_excludes:
        return True
    return looks_like_tribute(name)


def fetch_graspop():
    html = requests.get('https://www.graspop.be/en/line-up/a-z', timeout=30).text
    matches = re.findall(r'<a[^>]*href="/en/bands/[^"]+"[^>]*>(.*?)</a>', html, flags=re.I | re.S)
    artists = []
    for match in matches:
        name = clean_name(match)
        if name and name not in artists:
            artists.append(name)
    headliners = fetch_graspop_headliners()
    return artists, headliners


def fetch_graspop_headliners() -> list[str]:
    headliners = []
    for day in GRASPOP_DAYS:
        html = requests.get(f'https://www.graspop.be/en/line-up/{day}/stages', timeout=30).text
        stage_artists = {}
        for stage in ('South Stage', 'North Stage'):
            match = re.search(rf'<section[^>]+id="{re.escape(stage)}".*?</section>', html, flags=re.I | re.S)
            if not match:
                continue
            names = [
                clean_name(artist)
                for artist in re.findall(r'<h3 class="artist__name">(.*?)</h3>', match.group(0), flags=re.I | re.S)
            ]
            stage_artists[stage] = [name for name in names if name]

        # Main-stage closers first, then the directly preceding main-stage acts.
        # This mirrors how GMM announces the top-of-day acts and avoids the A-Z page order.
        for idx in (-1, -2):
            for stage in ('South Stage', 'North Stage'):
                names = stage_artists.get(stage, [])
                if len(names) >= abs(idx):
                    name = names[idx]
                    if name not in headliners:
                        headliners.append(name)
    return headliners


def fetch_rock_im_park():
    html = requests.get('https://www.rock-im-park.com/en/lineup', timeout=30).text
    items = re.findall(r'role="listitem" class="li ([^"]+)">(.*?)</span></span>', html, re.I | re.S)
    artists = []
    headliners = []
    for cls, frag in items:
        title_match = re.search(r'title="([^"]+)"', frag)
        span_match = re.search(r'<span title>([^<]+)</span>', frag)
        name = title_match.group(1) if title_match else (span_match.group(1) if span_match else None)
        if not name:
            continue
        name = clean_name(name)
        if name not in artists:
            artists.append(name)
            if cls == 'first-in-line':
                headliners.append(name)
    if not artists:
        return ROCK_IM_PARK_2026_ARTISTS, ROCK_IM_PARK_2026_HEADLINERS
    return artists, headliners[:8]


def fetch_wacken():
    data = requests.get('https://www.wacken.com/fileadmin/Json/bandlist-concert.json', timeout=30).json()
    artists = []
    for item in data:
        name = clean_name(item['artist']['title'])
        name = re.sub(r'^Out\s+Of\s+The\s+Cage\s+-\s+', '', name, flags=re.I)
        if name and name not in artists:
            artists.append(name)
    manual_headliners = [
        'Sabaton', 'Def Leppard', 'Powerwolf', 'Judas Priest',
        'In Flames', 'Savatage', 'Arch Enemy', 'Lamb of God', 'Sepultura',
    ]
    return artists, manual_headliners


def fetch_summer_breeze():
    home = requests.get('https://www.summer-breeze.de/', timeout=30).text
    head_block = re.search(r'lineup-links__bandlist--headliners.*?</ul>', home, re.S)
    headliners = [clean_name(x) for x in re.findall(r'<a href="https://www\.summer-breeze\.de/de/bands/[^"]+/">\s*([^<]+)\s*', head_block.group(0))] if head_block else []
    bands_html = requests.get('https://www.summer-breeze.de/de/bands/', timeout=30).text
    artists = []
    for match in re.findall(r'<h3 class="teaser__title">(.*?)</h3>', bands_html, re.S):
        name = clean_name(match)
        if name and name not in artists:
            artists.append(name)
    return artists, headliners


def fetch_impericon():
    headliners = ['Rise Against', 'Architects', 'BABYMETAL', 'Landmvrks', 'Black Veil Brides', 'We Came As Romans']
    artists = [
        'Rise Against', 'Architects', 'BABYMETAL', 'Landmvrks', 'Black Veil Brides', 'We Came As Romans',
        'Bloodywood', 'Catch Your Breath', 'Future Palace', 'Boundaries', 'Get The Shot', 'Nevertel',
        'The Pretty Wild', 'Distant', 'Gutalax', 'TSS', 'Mehnersmoos', 'Lionheart', 'The Menzingers',
        'Sleep Theory', 'Dying Wish', '100 Kilo Herz', 'I Killed The Prom Queen', 'The Browning',
        'Montreal', 'Siamese', 'Mental Cruelty', 'Cabal'
    ]
    return artists, headliners


def search_artist_mbid(name):
    if name in MBID_CACHE:
        return MBID_CACHE[name]
    if CACHE_ONLY_SETLIST and name in PERSISTENT_MBID_CACHE:
        MBID_CACHE[name] = PERSISTENT_MBID_CACHE[name]
        return MBID_CACHE[name]
    if CACHE_ONLY_SETLIST:
        MBID_CACHE[name] = None
        return None
    data = sl_get('https://api.setlist.fm/rest/1.0/search/artists', params={'artistName': name, 'p': 1, 'sort': 'relevance'})
    artists = data.get('artist') or []
    if isinstance(artists, dict):
        artists = [artists]
    mbid = None
    best_score = 0.0
    for artist in artists[:5]:
        candidate = artist.get('name') or ''
        query_tokens = simplify_name(name).split()
        candidate_tokens = simplify_name(candidate).split()
        if len(query_tokens) == 1 and query_tokens != candidate_tokens:
            continue
        score = token_overlap(name, candidate)
        if simplify_name(name) == simplify_name(candidate):
            score += 1.0
        if score > best_score:
            best_score = score
            mbid = artist.get('mbid')
    if best_score < 0.45:
        mbid = None
    MBID_CACHE[name] = mbid
    return mbid


def recent_setlists(mbid):
    if mbid in SETLIST_CACHE:
        return SETLIST_CACHE[mbid]
    if mbid in PERSISTENT_SETLIST_CACHE:
        result = PERSISTENT_SETLIST_CACHE[mbid]
        SETLIST_CACHE[mbid] = result
        return result
    if CACHE_ONLY_SETLIST:
        SETLIST_CACHE[mbid] = []
        return []
    try:
        data = sl_get(f'https://api.setlist.fm/rest/1.0/artist/{mbid}/setlists', params={'p': 1})
    except requests.exceptions.HTTPError as exc:
        response = getattr(exc, 'response', None)
        if response is not None and response.status_code == 404:
            SETLIST_CACHE[mbid] = []
            PERSISTENT_SETLIST_CACHE[mbid] = []
            return []
        raise
    setlists = data.get('setlist') or []
    if isinstance(setlists, dict):
        setlists = [setlists]
    result = setlists[:8]
    SETLIST_CACHE[mbid] = result
    PERSISTENT_SETLIST_CACHE[mbid] = result
    return result


def parse_setlist_date(raw: str) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.strptime(raw, '%d-%m-%Y')
    except ValueError:
        return None


def extract_recent_songs(setlists):
    cutoff = datetime.utcnow() - timedelta(days=RECENT_SETLIST_DAYS)
    counts = {}
    for setlist in setlists:
        when = parse_setlist_date(setlist.get('eventDate', ''))
        if when and when < cutoff:
            continue
        sets = setlist.get('sets', {}).get('set') or []
        if isinstance(sets, dict):
            sets = [sets]
        for subset in sets:
            songs = subset.get('song') or []
            if isinstance(songs, dict):
                songs = [songs]
            for song in songs:
                name = (song.get('name') or '').strip()
                if name:
                    counts[name] = counts.get(name, 0) + 1
    return counts


def canonical_track_key(name: str) -> str:
    name = FEATURE_CLAUSE_RE.sub('', name).strip()
    name = re.sub(r'\s*(?:[-(\[]\s*)?(?:\d{4}\s+)?remaster(?:ed)?\s*[)\]]?$', '', name, flags=re.I)
    simplified = simplify_name(name)
    if simplified:
        return simplified

    lowered = unicodedata.normalize('NFKC', name.lower())
    lowered = re.sub(r'[^\w]+', ' ', lowered, flags=re.UNICODE)
    return ' '.join(lowered.split())


def is_feat_track(track: dict) -> bool:
    title = (track.get('name') or '').lower()
    return any(token in title for token in [' feat.', ' featuring ', ' ft. ', '(feat', '[feat'])


def is_short_or_non_song(track: dict) -> bool:
    duration = track.get('duration_ms') or 0
    if duration < MIN_TRACK_MS:
        return True
    title = (track.get('name') or '').lower()
    return any(re.search(rf'(^|[\s(:\[-]){re.escape(hint)}($|[\s:)\]-])', title) for hint in NON_SONG_TITLE_HINTS)


def track_version_penalty(track: dict) -> int:
    title = (track.get('name') or '').lower()
    penalty = 0
    if re.search(r'(\(|\[|-)\s*live\b|\blive\s+(at|from|in|on)\b', title):
        penalty += 2
    if re.search(r'\b(remix|acoustic|instrumental|cover)\b', title):
        penalty += 2
    if re.search(r'(\(|\[|-)\s*(radio\s+)?edit\b', title):
        penalty += 2
    if re.search(r'(\(|\[|-)\s*(radio|extended|reworked)\s+version\b', title):
        penalty += 2
    if 'version' in title and any(hint in title for hint in BAD_VERSION_DESCRIPTOR_HINTS):
        penalty += 2
    return penalty


SPECIAL_ARTIST_INCLUDE = {}


def artist_family_match(query_artist: str, track: dict) -> bool:
    allowed = SPECIAL_ARTIST_INCLUDE.get(query_artist)
    if not allowed:
        return True
    track_artists = {artist['name'] for artist in track.get('artists', [])}
    return bool(track_artists & allowed)


def live_repertoire_primary_match(query_artist: str, track: dict) -> bool:
    allowed = LIVE_REPERTOIRE_PRIMARY_ARTISTS.get(query_artist)
    if not allowed:
        return False
    primary_artist = track['artists'][0]['name'] if track.get('artists') else ''
    return simplify_name(primary_artist) in {simplify_name(artist) for artist in allowed}


def primary_artist_matches_query(query_artist: str, track: dict) -> bool:
    if live_repertoire_primary_match(query_artist, track):
        return True
    primary_artist = track['artists'][0]['name'] if track.get('artists') else ''
    blocked_artists = BLOCKED_PRIMARY_ARTIST_MATCHES.get(query_artist, set())
    if simplify_name(primary_artist) in {simplify_name(artist) for artist in blocked_artists}:
        return False
    query_base = setlist_lookup_name(query_artist)
    raw_query_tokens = re.findall(r'[a-z0-9]+', query_artist.lower())
    raw_primary_tokens = re.findall(r'[a-z0-9]+', primary_artist.lower())
    if (
        len(raw_query_tokens) == 1
        and len(raw_primary_tokens) > 1
        and raw_primary_tokens[0] in BLOCKED_PRIMARY_ARTIST_PREFIXES
    ):
        return False
    query_tokens = simplify_name(query_base).split()
    primary_tokens = simplify_name(primary_artist).split()
    if len(query_tokens) == 1 and len(primary_tokens) > 1 and query_tokens[0] != primary_tokens[0]:
        return False
    overlap = token_overlap(query_base, primary_artist)
    if len(query_tokens) > 1 and len(primary_tokens) > 1 and overlap <= 0.5:
        return False
    return overlap >= 0.45


def should_skip_track_for_artist(query_artist: str, track: dict, lineup_artist: str | None = None) -> str | None:
    title = (track.get('name') or '').lower()
    primary_artist = track['artists'][0]['name'] if track.get('artists') else ''
    if is_short_or_non_song(track):
        return 'too_short_or_non_song'
    strict_artist = next(
        (artist for artist in (lineup_artist, query_artist) if artist in STRICT_ARTIST_ONLY_FALLBACK),
        None,
    )
    if strict_artist and not live_repertoire_primary_match(strict_artist, track) and simplify_name(primary_artist) != simplify_name(strict_artist):
        return 'strict_primary_artist_required'
    if not primary_artist_matches_query(query_artist, track):
        return 'primary_artist_mismatch'
    if not artist_family_match(query_artist, track):
        return 'artist_family_mismatch'
    if track_version_penalty(track) >= 2:
        return 'bad_version'
    if 'from "' in title or 'from (' in title:
        return 'soundtrack_style_version'
    return None


def spotify_search_track(artist, track, lineup_artist: str | None = None):
    cache_key = (artist, track, lineup_artist)
    if cache_key in TRACK_SEARCH_CACHE:
        return TRACK_SEARCH_CACHE[cache_key]
    search_artists = [artist]
    for allowed_artist in sorted(LIVE_REPERTOIRE_PRIMARY_ARTISTS.get(lineup_artist or artist, ())):
        if simplify_name(allowed_artist) != simplify_name(artist):
            search_artists.append(allowed_artist)
    items = []
    seen_item_ids = set()
    for search_artist in search_artists:
        data = spotify_get('https://api.spotify.com/v1/search', {'q': f'track:{track} artist:{search_artist}', 'type': 'track', 'limit': 8})
        for item in data.get('tracks', {}).get('items', []):
            item_id = item.get('id')
            if item_id and item_id in seen_item_ids:
                continue
            if item_id:
                seen_item_ids.add(item_id)
            items.append(item)
    best = None
    best_tuple = None
    target_key = canonical_track_key(track)
    for item in items:
        skip_reason = should_skip_track_for_artist(artist, item, lineup_artist)
        if skip_reason:
            continue
        artist_names = [a['name'] for a in item.get('artists', [])]
        match_score = max(token_overlap(artist, candidate) for candidate in artist_names) if artist_names else 0.0
        if simplify_name(artist) in [simplify_name(candidate) for candidate in artist_names]:
            match_score += 1.0
        if live_repertoire_primary_match(lineup_artist or artist, item):
            match_score += 1.0
        title_key = canonical_track_key(item.get('name', ''))
        title_score = 1.0 if title_key == target_key else token_overlap(track, item.get('name', ''))
        candidate_tuple = (
            match_score,
            title_score,
            not is_feat_track(item),
            -track_version_penalty(item),
            item.get('popularity', 0),
        )
        if best_tuple is None or candidate_tuple > best_tuple:
            best_tuple = candidate_tuple
            best = item
    if not best_tuple or best_tuple[0] < 0.45:
        best = None
    TRACK_SEARCH_CACHE[cache_key] = best
    return best


def spotify_get_artist_by_id(artist_id: str):
    cache_key = f'id:{artist_id}'
    if cache_key in ARTIST_SEARCH_CACHE:
        return ARTIST_SEARCH_CACHE[cache_key]
    artist = spotify_get(f'https://api.spotify.com/v1/artists/{artist_id}')
    ARTIST_SEARCH_CACHE[cache_key] = artist
    return artist


def spotify_search_artist(name):
    if name in ARTIST_SEARCH_CACHE:
        return ARTIST_SEARCH_CACHE[name]
    data = spotify_get('https://api.spotify.com/v1/search', {'q': name, 'type': 'artist', 'limit': 5})
    items = data.get('artists', {}).get('items', [])
    best = None
    best_score = 0.0
    for item in items:
        candidate = item.get('name', '')
        score = token_overlap(name, candidate)
        if simplify_name(name) == simplify_name(candidate):
            score += 1.0
        if score > best_score:
            best_score = score
            best = item
    if best_score < 0.45:
        best = None
    ARTIST_SEARCH_CACHE[name] = best
    return best


def spotify_top_tracks(name, limit=8, artist_id: str | None = None):
    artist = spotify_get_artist_by_id(artist_id) if artist_id else spotify_search_artist(name)
    if not artist:
        return None, []
    data = spotify_get(f"https://api.spotify.com/v1/artists/{artist['id']}/top-tracks", {'market': 'DE'})
    tracks = [track for track in data.get('tracks', []) if not is_short_or_non_song(track)]
    tracks.sort(key=lambda t: (
        is_feat_track(t),
        track_version_penalty(t),
        -t.get('popularity', 0),
        -int(simplify_name(t['artists'][0]['name']) == simplify_name(name)),
        t.get('name', ''),
    ))
    return artist, tracks[:limit]


def get_followers(artist_name, artist_id: str | None = None):
    cache_key = artist_id or artist_name
    if cache_key in FOLLOWERS_CACHE:
        return FOLLOWERS_CACHE[cache_key]
    artist = spotify_get_artist_by_id(artist_id) if artist_id else spotify_search_artist(artist_name)
    followers = (artist or {}).get('followers', {}).get('total', 0)
    FOLLOWERS_CACHE[cache_key] = followers
    return followers
    followers = (artist or {}).get('followers', {}).get('total', 0)
    FOLLOWERS_CACHE[artist_name] = followers
    return followers


def playlist_replace_all(playlist_id, uris):
    spotify_put(f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks', {'uris': uris[:100]})
    for idx in range(100, len(uris), 100):
        spotify_post(f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks', {'uris': uris[idx:idx + 100]})


def create_playlist(user_id, name, description):
    return spotify_post(f'https://api.spotify.com/v1/users/{user_id}/playlists', {'name': name, 'description': description, 'public': True})


def explain_track_choice(track: dict, source: str, artist: str, trigger: str) -> dict:
    return {
        'name': track['name'],
        'artist': track['artists'][0]['name'],
        'duration_ms': track.get('duration_ms'),
        'popularity': track.get('popularity'),
        'source': source,
        'trigger': trigger,
        'version_penalty': track_version_penalty(track),
    }


def setlist_track_sort_key(item: tuple[int, int, str, dict]) -> tuple:
    popularity, play_count, song, track = item
    return (-play_count, -popularity, is_feat_track(track), song.lower())


def build_playlist(festival: Festival, user_id: str):
    artists_raw, headliners = festival.lineup_fn()
    aliases = festival.aliases or {}
    spotify_artist_ids = festival.spotify_artist_ids or {}
    artists = [a for a in artists_raw if not should_exclude(a, festival)]
    selected_keys = selected_artist_keys()
    if selected_keys:
        if not REPORT_ONLY:
            raise RuntimeError('FESTIVAL_ARTISTS can only be used with FESTIVAL_REPORT_ONLY=1')
        artists = [a for a in artists if artist_matches_selected(a, aliases.get(a, a), selected_keys)]
    if not artists:
        raise RuntimeError(f'{festival.key}: lineup is empty; refusing to overwrite playlist')
    fast_sort = os.environ.get('FESTIVAL_FAST_SORT') == '1'
    followers = {}
    if not fast_sort:
        for artist in artists:
            query = aliases.get(artist, artist)
            followers[artist] = get_followers(query, spotify_artist_ids.get(artist))
    ordered_artists = [a for a in headliners if a in artists]
    rest = [a for a in artists if a not in ordered_artists]
    if not fast_sort:
        rest.sort(key=lambda a: followers.get(aliases.get(a, a), followers.get(a, 0)), reverse=True)
    ordered_artists.extend(rest)

    seen_uris = set()
    seen_song_keys = set()
    playlist_uris = []
    report = []
    for artist in ordered_artists:
        query_artist = aliases.get(artist, artist)
        setlist_artist = setlist_lookup_name(query_artist)
        spotify_artist_id = spotify_artist_ids.get(artist)
        forced_mbid = (festival.mbids or {}).get(artist)
        selected = []
        source = 'spotify-fallback'
        mbid = forced_mbid
        errors = []
        choice_log = []
        try:
            if not mbid:
                mbid = search_artist_mbid(setlist_artist)
            if mbid:
                recent_song_counts = extract_recent_songs(recent_setlists(mbid))
                if recent_song_counts:
                    source = 'setlist.fm'
                    matched_tracks = []
                    for song, play_count in sorted(recent_song_counts.items(), key=lambda item: (-item[1], item[0].lower())):
                        track = spotify_search_track(setlist_artist, song, artist)
                        if not track:
                            choice_log.append({'source': 'setlist.fm', 'trigger': song, 'skip': 'no_spotify_match'})
                            continue
                        skip_reason = should_skip_track_for_artist(query_artist, track, artist)
                        if skip_reason:
                            choice_log.append({'source': 'setlist.fm', 'trigger': song, 'skip': skip_reason, 'matched': track['name']})
                            continue
                        matched_tracks.append((track.get('popularity', 0), play_count, song, track))
                    matched_tracks.sort(key=setlist_track_sort_key)
                    for _, play_count, song, track in matched_tracks:
                        song_key = canonical_track_key(track['name'])
                        if song_key in seen_song_keys:
                            choice_log.append({'source': 'setlist.fm', 'trigger': song, 'skip': 'duplicate_song_key', 'matched': track['name']})
                            continue
                        if track['uri'] in seen_uris:
                            choice_log.append({'source': 'setlist.fm', 'trigger': song, 'skip': 'duplicate_uri', 'matched': track['name']})
                            continue
                        seen_uris.add(track['uri'])
                        seen_song_keys.add(song_key)
                        selected.append(track)
                        info = explain_track_choice(track, 'setlist.fm', artist, song)
                        info['recent_setlist_plays'] = play_count
                        choice_log.append(info)
                        if len(selected) >= 5:
                            break
        except Exception as exc:
            errors.append(f'setlist lookup failed: {exc}')

        if len(selected) < 5:
            fallback_names = list(dict.fromkeys([query_artist, artist]))
            for fallback_name in fallback_names:
                try:
                    _, tracks = spotify_top_tracks(fallback_name, 10, artist_id=spotify_artist_id)
                    for track in tracks:
                        artist_names = [a['name'] for a in track.get('artists', [])]
                        if max(token_overlap(query_artist, candidate) for candidate in artist_names) < 0.45:
                            choice_log.append({'source': 'spotify-fallback', 'trigger': fallback_name, 'skip': 'artist_mismatch', 'matched': track['name']})
                            continue
                        skip_reason = should_skip_track_for_artist(query_artist, track, artist)
                        if skip_reason:
                            choice_log.append({'source': 'spotify-fallback', 'trigger': fallback_name, 'skip': skip_reason, 'matched': track['name']})
                            continue
                        song_key = canonical_track_key(track['name'])
                        if song_key in seen_song_keys:
                            choice_log.append({'source': 'spotify-fallback', 'trigger': fallback_name, 'skip': 'duplicate_song_key', 'matched': track['name']})
                            continue
                        if track['uri'] in seen_uris:
                            choice_log.append({'source': 'spotify-fallback', 'trigger': fallback_name, 'skip': 'duplicate_uri', 'matched': track['name']})
                            continue
                        seen_uris.add(track['uri'])
                        seen_song_keys.add(song_key)
                        selected.append(track)
                        choice_log.append(explain_track_choice(track, 'spotify-fallback', artist, fallback_name))
                        if len(selected) >= 5:
                            break
                except Exception as exc:
                    errors.append(f'spotify fallback failed for {fallback_name}: {exc}')
                if len(selected) >= 5:
                    break

        final_tracks = selected[:5]
        playlist_uris.extend(track['uri'] for track in final_tracks)
        report.append({
            'artist': artist,
            'query_artist': query_artist,
            'followers': followers.get(artist, 0),
            'source': source,
            'count': len(final_tracks),
            'headliner': artist in headliners,
            'tracks': [f"{track['artists'][0]['name']} - {track['name']}" for track in final_tracks],
            'mbid': mbid,
            'errors': errors,
            'choice_log': choice_log,
        })
        print(f'[{festival.key}] {artist}: {len(final_tracks)} tracks')

    if REPORT_ONLY:
        playlist_id = festival.existing_playlist_id or f'{festival.key}-report-only'
        playlist_url = f'https://open.spotify.com/playlist/{playlist_id}' if festival.existing_playlist_id else ''
    elif festival.existing_playlist_id:
        playlist_id = festival.existing_playlist_id
        update_playlist_details(playlist_id, festival.playlist_name, festival.description)
        playlist_replace_all(playlist_id, playlist_uris)
        playlist_url = f'https://open.spotify.com/playlist/{playlist_id}'
    else:
        playlist = create_playlist(user_id, festival.playlist_name, festival.description)
        playlist_id = playlist['id']
        playlist_url = playlist['external_urls']['spotify']
        update_playlist_details(playlist_id, festival.playlist_name, festival.description)
        playlist_replace_all(playlist_id, playlist_uris)

    output = {
        'festival': festival.display_name,
        'playlist_name': festival.playlist_name,
        'playlist_id': playlist_id,
        'playlist_url': playlist_url,
        'track_count': len(playlist_uris),
        'artists_count': len(ordered_artists),
        'headliners': headliners,
        'report': report,
    }
    report_path = REPORT_DIR / f'{festival.key}.json'
    if REPORT_ONLY and not playlist_uris and report_path.exists():
        existing = json.loads(report_path.read_text(encoding='utf-8'))
        if existing.get('track_count', 0) > 0:
            raise RuntimeError(f'refusing to overwrite non-empty report with zero tracks: {report_path}')
    if REPORT_ONLY and selected_keys and report_path.exists():
        existing = json.loads(report_path.read_text(encoding='utf-8'))
        updated = {simplify_name(entry['artist']): entry for entry in report}
        merged_report = []
        seen = set()
        for entry in existing.get('report', []):
            key = simplify_name(entry.get('artist', ''))
            if key in updated:
                merged_report.append(updated[key])
                seen.add(key)
            else:
                merged_report.append(entry)
        for entry in report:
            key = simplify_name(entry['artist'])
            if key not in seen:
                merged_report.append(entry)
        existing['report'] = merged_report
        existing['track_count'] = sum(entry.get('count', len(entry.get('tracks', []))) for entry in merged_report)
        existing['artists_count'] = len(merged_report)
        output = existing
    report_path.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    SETLIST_CACHE_FILE.write_text(json.dumps(PERSISTENT_SETLIST_CACHE, ensure_ascii=False), encoding='utf-8')
    print(json.dumps({
        'festival': festival.key,
        'playlist_url': output['playlist_url'],
        'track_count': output['track_count'],
        'artists_count': output['artists_count'],
    }))


def main():
    if not CACHE_ONLY_SETLIST:
        require_setlist_api_key()
    festivals = [
        Festival(
            key='graspop_2026',
            display_name='Graspop Metal Meeting 2026',
            playlist_name='Graspop 2026: Festival Crash Course',
            description='Listen to all bands from Graspop 2026.',
            lineup_fn=fetch_graspop,
            existing_playlist_id='3jyENqyk94CZYS71X2S7GY',
            aliases={'Cavalera "Chaos A.D."': 'Cavalera', 'Death To All': 'Death to All'},
            extra_excludes={'Bulls on Parade'},
        ),
        Festival(
            key='rock_im_park_2026',
            display_name='Rock im Park 2026',
            playlist_name='Rock im Park 2026: Festival Crash Course',
            description='Listen to all bands from Rock im Park 2026.',
            lineup_fn=fetch_rock_im_park,
            existing_playlist_id='5FlpRlZJqzOndB3E2s2eB8',
            aliases={'Babymetal': 'BABYMETAL', 'Return to Dust': 'Return To Dust', 'Letlive.': 'letlive.'},
            spotify_artist_ids={'Finch': '1ZyqnbV7Brg5LgyS4EZCUD'},
            mbids={'Finch': '92653164-7cbd-468f-afa3-b0baa3e05986'},
        ),
        Festival(
            key='wacken_2026',
            display_name='Wacken Open Air 2026',
            playlist_name='Wacken 2026: Festival Crash Course',
            description='Listen to all bands from Wacken Open Air 2026.',
            lineup_fn=fetch_wacken,
            existing_playlist_id='5TWytVVqnSFQw6eVdhBIK6',
            aliases={
                'Born Broken': 'BornBroken',
                'Force': 'FORCE',
                'Jäst': 'JÄST',
                'Lamb of God': 'Lamb Of God',
                'Heaven Shall Burn': 'Heaven Shall Burn',
                'Mac Cabe & Kanaka': 'MacCabe & Kanaka',
                'Of Mice and Men': 'Of Mice & Men',
                'Phantom': 'Phantom G.D.L',
                'Dieter "Maschine" Birr': 'Dieter "Maschine" Birr',
                'Novelization': 'Novelization',
            },
            spotify_artist_ids={
                'Born Broken': '1eK0MDcJMrahfqgCjlPEzl',
                'Force': '527C8v9EOKmi9W2tApAIag',
                'Gidora': '4cJUKhSNedofM9UgiAMl3L',
                'Haine': '4SH9v6X1z8BEOL1E2JLgYd',
                'Jäst': '3pejAqOcOsnG28IwNshhFk',
                'Mac Cabe & Kanaka': '6Ds9FJPSEtOzl9s2vRWX2A',
                'Novelization': '3poazkVxpS4USWiABaOBAZ',
                'Phantom': '6f9WeAPRDSevpjBAyGfVmV',
                'SÓT': '6Nc1Qeqwnbi0odTnFc0Lua',
            },
            extra_excludes={
                'Maschine\'s Late Night Show', 'Wacken Firefighters', 'Cowgirls From Hell',
                'Blood Fire Death', 'Electric Bassboy', 'Kay Ray', 'Metal Karate', 'Bastian Zach',
                'Blaas of Glory', 'Jazz Sabbath', 'The Ukeboys', 'Vika Goes Wild',
                'Adrian Pauls Rockin\' Roncalli Show', 'Corrupted Blood - Pit Session',
                'Dragons & Pois Show',
                'Acoustic Guerillas feat Ellerbek Pussyboys', 'Acoustic Steel',
                'Lesung: Maxim Matthew "Frøstfǽdrin- Der Ruf des weißen Greifen"', 'Metal Battle tba.',
                'System of a Down by Anett & Livi Acoustic + Radó Éden', 'Tribute2Wacken', 'Wildcover',
                'Alien Rockin Explosion', 'Kalle 4 World Leader', 'Sir Henry Hot', 'Telekom Wacken Cup',
            },
        ),
        Festival(
            key='impericon_leipzig_2026',
            display_name='Impericon 2026',
            playlist_name='Impericon 2026: Festival Crash Course',
            description='Listen to all bands from Impericon 2026.',
            lineup_fn=fetch_impericon,
            existing_playlist_id='2jMqmVKjXfoOjflwyZ5E5D',
            spotify_artist_ids={'Montreal': '1WBgY3ppwWenEynLyKUNRk'},
            mbids={'Montreal': '87cf6aa6-a005-445b-8920-1c5b3fdfbfaa'},
        ),
        Festival(
            key='summer_breeze_2026',
            display_name='Summer Breeze 2026',
            playlist_name='Summer Breeze 2026: Festival Crash Course',
            description='Listen to all bands from Summer Breeze 2026.',
            lineup_fn=fetch_summer_breeze,
            existing_playlist_id='6rWAXV1sR2E6ZDbHcWBVfD',
            aliases={'Lamb Of God': 'Lamb Of God', 'Paleface Swiss': 'Paleface Swiss'},
            extra_excludes={
                'Randale *Familienkonzert*', 'RODSCHA AUS KAMBODSCHA UND TOM PALME',
                'Blasmusik Illenschwang', 'Harsh Vocals mit Britta Görtz',
                'Metalza – Metal Workout', 'Metal Yoga', 'Into The Voidcast',
            },
        ),
    ]
    selected = os.environ.get('FESTIVALS')
    if selected:
        allowed = {item.strip() for item in selected.split(',') if item.strip()}
        festivals = [festival for festival in festivals if festival.key in allowed]
    user_id = '' if REPORT_ONLY else spotify_get('https://api.spotify.com/v1/me')['id']
    for festival in festivals:
        build_playlist(festival, user_id)


if __name__ == '__main__':
    main()
