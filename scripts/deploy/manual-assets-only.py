#!/usr/bin/env python3
"""Fixed manual assets repair; never activate a release or invoke a logo job.

All remote verification runs as festival-radar-deploy. Releases are www-data
owned by install-release.sh; libexec assets and the unit must be root-owned.
An older updater may only update itself: post-verification deliberately fails
in that case. There is no automatic second invocation or deployment fallback.
"""
import hashlib
import inspect
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ASSETS = ('activate-release', 'install-release.sh', 'upgrade-deployment-assets', 'start-logo-import')
RELEASE_FILES = ('scripts/deploy/run-reviewed-logo-import.ts', 'scripts/deploy/logo-import-assets.sh',
                 'lib/catalog/logo-import.ts')
HEALTH_URL = 'https://festivals.kir-it.de/api/health/deployment/'


def require(condition):
    if not condition:
        raise ValueError('assets-only gate rejected')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result)
        result[key] = value
    return result


def validate_health(raw, commit):
    require(len(raw) <= 65536)
    body = json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda _: require(False))
    require(isinstance(body, dict))
    for key, expected in {'status': 'ok', 'database': 'ok', 'catalog': 'database', 'commit': commit}.items():
        require(body.get(key) == expected)


def remote_verify(commit, manifest, after):
    # This function is sent over stdin to unprivileged python3, never to sudo.
    import pwd
    import stat

    require(os.getuid() == pwd.getpwnam('festival-radar-deploy').pw_uid)
    app_uid = pwd.getpwnam('www-data').pw_uid
    app_gid = pwd.getpwnam('www-data').pw_gid

    def identity(metadata):
        # Reading can update atime; only content/identity changes invalidate a check.
        return (metadata.st_dev, metadata.st_ino, metadata.st_mode, metadata.st_uid,
                metadata.st_gid, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)

    def check(path, uid, gid, mode, directory=False, digest=None, contents=None):
        entry = Path(path)
        metadata = entry.lstat()
        require(not stat.S_ISLNK(metadata.st_mode))
        require(stat.S_ISDIR(metadata.st_mode) if directory else stat.S_ISREG(metadata.st_mode))
        require((metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) == (uid, gid, mode))
        if not directory:
            # O_NOFOLLOW also rejects a final-component replacement with a link.
            fd = os.open(entry, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as stream:
                require(identity(os.fstat(stream.fileno())) == identity(metadata))
                data = stream.read()
            require(identity(entry.lstat()) == identity(metadata))
            if digest is not None:
                require(hashlib.sha256(data).hexdigest() == digest)
            if contents is not None:
                require(data == contents)
            return data

    for directory in ('/', '/opt', '/opt/festival-radar', '/opt/festival-radar/releases',
                      '/usr', '/usr/local', '/usr/local/libexec', '/usr/local/libexec/festival-radar',
                      '/etc', '/etc/systemd', '/etc/systemd/system'):
        check(directory, 0, 0, 0o755, directory=True)
    release = '/opt/festival-radar/releases/' + commit
    check(release, app_uid, app_gid, 0o755, directory=True)
    current = Path('/opt/festival-radar/current')
    metadata = current.lstat()
    require(stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_gid == 0)
    require(os.readlink(current) == release and str(current.resolve(strict=True)) == release)
    check(release + '/DEPLOYED_COMMIT', app_uid, app_gid, 0o644, contents=(commit + '\n').encode())
    for directory in ('scripts', 'scripts/deploy', 'lib', 'lib/catalog', '.runtime'):
        check(release + '/' + directory, app_uid, app_gid, 0o755, directory=True)
    for name, digest in manifest['release'].items():
        check(release + '/' + name, app_uid, app_gid, 0o644, digest=digest)
    check(release + '/.runtime/node', app_uid, app_gid, 0o755)
    check('/etc/systemd/system/festival-radar-logo-import@.service', 0, 0, 0o644, digest=manifest['unit'])
    destination = '/usr/local/libexec/festival-radar/'
    # The installed updater can be older before repair; never execute an unsafe one.
    check(destination + 'upgrade-deployment-assets', 0, 0, 0o755,
          digest=manifest['assets']['upgrade-deployment-assets'] if after else None)
    if not after:
        # In particular, the updater writes its marker with shell redirection.
        # Refuse an existing unsafe destination before any privileged writes.
        for name in (*manifest['assets'], 'DEPLOYMENT_ASSETS_COMMIT'):
            try:
                Path(destination + name).lstat()
            except FileNotFoundError:
                continue  # Missing assets are the reason for this repair.
            marker = name == 'DEPLOYMENT_ASSETS_COMMIT'
            data = check(destination + name, 0, 0, 0o644 if marker else 0o755)
            if marker:
                require(len(data) == 41 and data[-1:] == b'\n' and
                        all(value in b'0123456789abcdef' for value in data[:-1]))
    if after:
        check(destination + 'DEPLOYMENT_ASSETS_COMMIT', 0, 0, 0o644, contents=(commit + '\n').encode())
        for name, digest in manifest['assets'].items():
            check(destination + name, 0, 0, 0o755, digest=digest)
    require(identity(current.lstat()) == identity(metadata) and os.readlink(current) == release)


def run(command, payload=None):
    # No raw SSH, sudo, curl, or response output is forwarded to Actions logs.
    result = subprocess.run(command, input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, timeout=120, check=True)
    return result.stdout


def manifest_for(commit):
    def source(name):
        return run(['git', 'show', commit + ':' + name])

    def digest(data):
        return hashlib.sha256(data).hexdigest()

    installer = source('scripts/deploy/install-release.sh').decode()
    start = 'cat > "/etc/systemd/system/$service-logo-import@.service" <<UNIT\n'
    require(installer.count(start) == 1)
    unit = installer.split(start, 1)[1].split('\nUNIT\n', 1)[0] + '\n'
    unit = (unit.replace('$service', 'festival-radar').replace('$app_root', '/opt/festival-radar')
            .replace('$shared', '/opt/festival-radar/shared'))
    require('$' not in unit)
    return {'assets': {name: digest(source('scripts/deploy/' + name)) for name in ASSETS},
            'release': {name: digest(source(name)) for name in RELEASE_FILES}, 'unit': digest(unit.encode())}


def verify_remote(commit, manifest, after):
    payload = 'import os, hashlib\nfrom pathlib import Path\n'
    payload += inspect.getsource(require) + '\n' + inspect.getsource(remote_verify)
    payload += '\ntry:\n    remote_verify(' + repr(commit) + ', ' + repr(manifest) + ', ' + repr(after) + ')\n'
    payload += 'except Exception:\n    raise SystemExit(1)\n'
    require(run(['ssh', 'production', 'python3', '-'], payload.encode()) == b'')


def health(commit):
    validate_health(run(['curl', '--fail', '--silent', '--proto', '=https', '--tlsv1.2',
                         '--connect-timeout', '10', '--max-time', '20', HEALTH_URL]), commit)


def main():
    require(len(sys.argv) == 1)
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main')
    commit = os.environ.get('GITHUB_SHA', '')
    require(re.fullmatch('[0-9a-f]{40}', commit) is not None)
    require(run(['git', 'rev-parse', 'HEAD']).decode().strip() == commit)
    manifest = manifest_for(commit)
    health(commit)
    verify_remote(commit, manifest, False)
    # The ONLY privileged invocation. Existing sudo grant, no new root entrypoint.
    run(['ssh', 'production', 'sudo', '-n',
         '/usr/local/libexec/festival-radar/upgrade-deployment-assets', commit])
    verify_remote(commit, manifest, True)
    health(commit)
    print('Assets-only upgrade verified for exact deployed commit.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Assets-only upgrade failed closed; no deployment or logo fallback.', file=sys.stderr)
        sys.exit(1)
