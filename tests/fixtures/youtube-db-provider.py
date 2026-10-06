"""Synthetic provider only. Real worker checkpoint protocol against test PostgreSQL."""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_youtube_playlist_plan import Provider
from youtube_playlist_plan import publish_plan

plan_path, remote_path = map(Path, sys.argv[1:3])
provider = Provider(creating=True)
provider.plan = json.loads(plan_path.read_text())
if remote_path.exists():
    remote = json.loads(remote_path.read_text())
    provider.metadata = remote['metadata']
    provider.items = remote['items']
    provider.serial = remote['serial']
    provider.calls = [tuple(call) for call in remote['calls']]
provider.unknown = sys.argv[3] if len(sys.argv) > 3 else None


def state(action, payload=None):
    reply = subprocess.run([os.environ['PLAYLIST_GUARD_NODE'], '--experimental-strip-types', os.environ['YOUTUBE_GUARD_SCRIPT'], action],
                           input=json.dumps(payload) if payload is not None else None, text=True, capture_output=True, check=True, timeout=20)
    result = json.loads(reply.stdout)
    if action != 'progress':
        provider.saved = result
    return result


def guard():
    state('read')
    provider.fenced = True


try:
    result = publish_plan(provider.plan, provider.request, guard, state, lambda data: state('progress', data))
    print(json.dumps(result))
except Exception:
    sys.stderr.write('synthetic_youtube_attempt_failed\n')
    sys.exit(1)
finally:
    remote_path.write_text(json.dumps({'metadata': provider.metadata, 'items': provider.items, 'serial': provider.serial, 'calls': provider.calls}))
