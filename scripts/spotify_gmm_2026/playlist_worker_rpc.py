"""One bounded JSON request/reply; authoritative plans/checkpoints remain in DB."""
from __future__ import annotations

import contextlib
import json
import os
import sys

MAX_INPUT_BYTES = 8 * 1024 * 1024


def execute(operation, value):
    if operation == 'discover-spotify':
        # Set before import: the planner must not load or create report/cache files.
        os.environ['FESTIVAL_WORKER_STDIO'] = '1'
        os.environ['FESTIVAL_REPORT_ONLY'] = '1'
        import festival_playlists as planner
        if not planner.WORKER_STDIO or not planner.REPORT_ONLY:
            raise RuntimeError('Fileless report-only planner required')
        if not planner.CACHE_ONLY_SETLIST:
            planner.require_setlist_api_key()
        _, festivals, skipped = planner.parse_canonical_festivals(value)
        if skipped or len(festivals) != 1:
            raise ValueError('Exactly one eligible edition required')
        return planner.build_playlist(festivals[0], '', persist_report=False)
    if operation == 'apply-spotify':
        from apply_playlist_plan import run_plan
        return run_plan(value)
    if operation in ('discover-youtube', 'apply-youtube'):
        from youtube_playlist_plan import run_plan
        return run_plan(operation.split('-')[0], value)
    raise ValueError('Unknown playlist operation')


def main():
    os.environ['FESTIVAL_WORKER_STDIO'] = '1'
    sys.dont_write_bytecode = True
    if len(sys.argv) != 2:
        raise ValueError('Exactly one operation required')
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError('Playlist request too large')
    value = json.loads(raw)
    # Existing planner progress is diagnostic; stdout contains only the reply.
    with contextlib.redirect_stdout(sys.stderr):
        result = execute(sys.argv[1], value)
    sys.stdout.write(json.dumps(result, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        from youtube_playlist_plan import QuotaBoundReached, ReconciliationRequired, ProviderWriteRejected, failure_diagnostic
        if isinstance(error, QuotaBoundReached):
            sys.stderr.write('youtube_quota_bound_reached\n')
            sys.exit(2)
        if isinstance(error, ReconciliationRequired):
            detail = failure_diagnostic(error)
            sys.stderr.write('youtube_reconciliation_required\n' + (detail + '\n' if detail != 'youtube_plan_failed' else ''))
            sys.exit(3)
        if isinstance(error, ProviderWriteRejected):
            sys.stderr.write(failure_diagnostic(error) + '\n')
            sys.exit(1)
        sys.stderr.write('playlist_rpc_failed\n')
        sys.exit(1)
