import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def load_mapping(value: str) -> dict[str, str]:
    if not value:
        return {}
    parsed = json.loads(value)
    if not isinstance(parsed, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in parsed.items()):
        raise ValueError('YOUTUBE_MUSIC_PLAYLIST_IDS must be a JSON object of slug to playlist id')
    return parsed


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
                results.append({'slug': slug, 'status': 'failed', 'returncode': 2, 'error': 'missing persisted playlist id; create it explicitly before unattended refresh'})
                continue
            command.extend(['--publish', '--playlist-id', playlist_id, '--resume-publish', '--update-metadata'])
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        results.append({'slug': slug, 'status': 'ok' if completed.returncode == 0 else 'failed', 'returncode': completed.returncode, 'error': completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else ''})
    summary = {'publish': publish, 'processed': len(results), 'succeeded': sum(item['status'] == 'ok' for item in results), 'skipped': sum(item['status'] == 'skipped_empty' for item in results), 'failed': sum(item['status'] == 'failed' for item in results), 'results': results}
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
    mapping = load_mapping(os.environ.get('YOUTUBE_MUSIC_PLAYLIST_IDS', ''))
    if args.publish and not mapping:
        raise RuntimeError('YOUTUBE_MUSIC_PLAYLIST_IDS is required for unattended publishing')
    summary = run_all(Path(args.reports), Path(args.output), mapping, publish=args.publish, credentials=Path(args.credentials) if args.credentials else None, oauth=Path(args.oauth) if args.oauth else None)
    print(json.dumps(summary))
    return 1 if summary['failed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
