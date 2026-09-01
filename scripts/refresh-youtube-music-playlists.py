import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


PLAYLIST_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{10,}$')


def load_mapping(value: str) -> dict[str, str]:
    if not value:
        return {}
    parsed = json.loads(value)
    if not isinstance(parsed, dict) or not all(
        isinstance(k, str)
        and bool(k.strip())
        and isinstance(v, str)
        and bool(PLAYLIST_ID_PATTERN.fullmatch(v))
        for k, v in parsed.items()
    ):
        raise ValueError('YOUTUBE_MUSIC_PLAYLIST_IDS must be a JSON object of slug to playlist id')
    return parsed


def validate_provider_files(credentials: Path | None, oauth: Path | None) -> list[str]:
    missing = []
    required = (
        ('credentials', credentials, ('client_id', 'client_secret')),
        ('oauth', oauth, ('refresh_token',)),
    )
    for label, path, fields in required:
        if path is None or not path.is_file():
            missing.append(f'{label}_file')
            continue
        try:
            parsed = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            missing.append(f'{label}_json')
            continue
        if not isinstance(parsed, dict) or any(not isinstance(parsed.get(field), str) or not parsed[field].strip() for field in fields):
            missing.append(f'{label}_fields')
    return missing


def classify_provider_failure(stderr: str) -> str:
    normalized = stderr.casefold()
    if any(marker in normalized for marker in ('quota', 'ratelimit', 'rate limit', 'too many requests')):
        return 'quota'
    if any(marker in normalized for marker in ('invalid_grant', 'unauthorized', 'authentication', 'invalid credentials', 'access token')):
        return 'authentication'
    if any(marker in normalized for marker in ('playlist id', 'playlist not found', 'playlistnotfound', 'persisted playlist id')):
        return 'mapping'
    return 'publishing'


def run_all(report_dir: Path, output_dir: Path, playlist_ids: dict[str, str], *, publish: bool, credentials: Path | None = None, oauth: Path | None = None) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    results = []
    for report in sorted(report_dir.glob('*.json')):
        if report.name.endswith('_summary.json'):
            continue
        source = json.loads(report.read_text(encoding='utf-8'))
        slug = source.get('slug') or report.stem
        if int(source.get('artists_count') or 0) <= 0 or int(source.get('track_count') or 0) <= 0:
            results.append({'slug': slug, 'status': 'skipped_empty'})
            continue
        command = [sys.executable, str(Path(__file__).with_name('spotify_gmm_2026') / 'youtube_music_transfer.py'), '--report', str(report), '--output', str(output_dir / f'{slug}.json')]
        if credentials:
            command.extend(['--credentials', str(credentials)])
        if oauth:
            command.extend(['--oauth', str(oauth)])
        playlist_id = playlist_ids.get(slug, '')
        if publish:
            if not playlist_id:
                results.append({'slug': slug, 'status': 'skipped_unmapped', 'category': 'mapping'})
                continue
            command.extend(['--publish', '--playlist-id', playlist_id, '--resume-publish', '--update-metadata'])
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        category = 'healthy' if completed.returncode == 0 else classify_provider_failure(completed.stderr)
        results.append({
            'slug': slug,
            'status': 'ok' if completed.returncode == 0 else 'failed',
            'category': category,
            'returncode': completed.returncode,
        })
    succeeded = sum(item['status'] == 'ok' for item in results)
    failed = sum(item['status'] == 'failed' for item in results)
    attempted = succeeded + failed
    unmapped = sum(item['status'] == 'skipped_unmapped' for item in results)
    skipped_empty = sum(item['status'] == 'skipped_empty' for item in results)
    provider_status = 'failure' if failed or (publish and attempted == 0) else 'success'
    failure_categories = sorted({item['category'] for item in results if item['status'] == 'failed'})
    summary = {
        'provider': 'youtube_music',
        'status': provider_status,
        'publish': publish,
        'processed': len(results),
        'attempted': attempted,
        'succeeded': succeeded,
        'skipped': skipped_empty + unmapped,
        'unmapped': unmapped,
        'failed': failed,
        'health': {
            'configuration': 'healthy',
            'authentication': 'failure' if 'authentication' in failure_categories else ('healthy' if succeeded else 'not_checked'),
            'quota': 'failure' if 'quota' in failure_categories else ('healthy' if succeeded else 'not_checked'),
            'mapping': 'failure' if 'mapping' in failure_categories else ('partial' if unmapped else 'healthy'),
            'publishing': 'failure' if 'publishing' in failure_categories else ('healthy' if succeeded else 'not_checked'),
        },
        'results': results,
    }
    (output_dir / '_summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description='Safely refresh all eligible YouTube Music festival playlists.')
    parser.add_argument('--reports', default='outputs/festival_playlists')
    parser.add_argument('--output', default='outputs/youtube_music')
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--credentials')
    parser.add_argument('--oauth')
    args = parser.parse_args()
    try:
        mapping = load_mapping(os.environ.get('YOUTUBE_MUSIC_PLAYLIST_IDS', ''))
    except (ValueError, json.JSONDecodeError):
        mapping = {}
        configuration_errors = ['playlist_mapping_json']
    else:
        configuration_errors = []
    if args.publish:
        if not mapping:
            configuration_errors.append('playlist_mapping')
        configuration_errors.extend(validate_provider_files(
            Path(args.credentials) if args.credentials else None,
            Path(args.oauth) if args.oauth else None,
        ))
    if configuration_errors:
        output_dir = Path(args.output)
        output_dir.mkdir(parents=True, exist_ok=True)
        summary = {
            'provider': 'youtube_music',
            'status': 'failure',
            'publish': args.publish,
            'processed': 0,
            'attempted': 0,
            'succeeded': 0,
            'skipped': 0,
            'unmapped': 0,
            'failed': 1,
            'health': {
                'configuration': 'failure',
                'authentication': 'not_checked',
                'quota': 'not_checked',
                'mapping': 'failure' if any(item.startswith('playlist_mapping') for item in configuration_errors) else 'not_checked',
                'publishing': 'not_checked',
            },
            'configuration_errors': sorted(set(configuration_errors)),
            'results': [],
        }
        (output_dir / '_summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(summary))
        return 1
    summary = run_all(Path(args.reports), Path(args.output), mapping, publish=args.publish, credentials=Path(args.credentials) if args.credentials else None, oauth=Path(args.oauth) if args.oauth else None)
    print(json.dumps(summary))
    return 0 if summary['status'] == 'success' else 1


if __name__ == '__main__':
    raise SystemExit(main())
