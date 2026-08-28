import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import youtube_music_transfer as transfer


def is_quota_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return 'quotaexceeded' in text or 'quota exceeded' in text


def run_transfer(args: argparse.Namespace) -> dict:
    command = [
        sys.executable,
        str(Path(__file__).with_name('youtube_music_transfer.py')),
        '--publish',
        '--resume-publish',
        '--playlist-id',
        args.playlist_id,
        '--credentials',
        str(args.credentials),
        '--oauth',
        str(args.oauth),
        '--report',
        str(args.report),
        '--output',
        str(args.output),
        '--cache',
        str(args.cache),
        '--max-new-items',
        str(args.max_new_items),
    ]
    if args.pause_seconds:
        command.extend(['--pause-seconds', str(args.pause_seconds)])

    result = subprocess.run(command, check=False, text=True, capture_output=True)
    if result.returncode != 0:
        return {
            'step': 'publish',
            'status': 'quota_wait' if is_quota_error(RuntimeError(result.stderr)) else 'failed',
            'returncode': result.returncode,
            'stderr_tail': result.stderr.strip().splitlines()[-5:],
        }

    summary = {}
    for line in reversed(result.stdout.strip().splitlines()):
        try:
            summary = json.loads(line)
            break
        except json.JSONDecodeError:
            continue
    return {
        'step': 'publish',
        'status': 'ok',
        'summary': summary,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description='Check YouTube Data API quota and resume a playlist transfer.')
    parser.add_argument('--playlist-id', default=os.environ.get('YOUTUBE_MUSIC_PLAYLIST_ID', ''))
    parser.add_argument('--credentials', default=str(transfer.DEFAULT_CREDENTIALS))
    parser.add_argument('--oauth', default=str(transfer.DEFAULT_OAUTH))
    parser.add_argument('--report', default='outputs/festival_playlists/summer_breeze_2026.json')
    parser.add_argument('--output', default=str(transfer.DEFAULT_OUTPUT_DIR / 'summer_breeze_2026.json'))
    parser.add_argument('--cache', default=str(transfer.DEFAULT_CACHE))
    parser.add_argument('--max-new-items', type=int, default=transfer.DEFAULT_MAX_NEW_ITEMS)
    parser.add_argument('--pause-seconds', type=float, default=0.0)
    args = parser.parse_args()

    if not args.playlist_id:
        raise RuntimeError('playlist id is required via --playlist-id or YOUTUBE_MUSIC_PLAYLIST_ID')

    try:
        current = transfer.list_youtube_playlist_items(Path(args.credentials), Path(args.oauth), args.playlist_id)
    except Exception as exc:
        status = 'quota_wait' if is_quota_error(exc) else 'failed'
        print(json.dumps({
            'step': 'quota_check',
            'status': status,
            'playlist_id': args.playlist_id,
            'error': str(exc),
        }, ensure_ascii=False))
        return 0 if status == 'quota_wait' else 1

    quota_check = {
        'step': 'quota_check',
        'status': 'ok',
        'playlist_id': args.playlist_id,
        'existing_count': len(current),
        'estimated_quota_units': max(1, (len(current) + 49) // 50) * transfer.YOUTUBE_QUOTA_PLAYLIST_ITEM_LIST,
    }
    print(json.dumps(quota_check, ensure_ascii=False), flush=True)

    publish = run_transfer(args)
    print(json.dumps(publish, ensure_ascii=False))
    return 1 if publish['status'] == 'failed' else 0


if __name__ == '__main__':
    sys.exit(main())
