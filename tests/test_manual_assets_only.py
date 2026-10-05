"""Offline contract/gate tests for #210. No SSH, HTTP or sudo is executed."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('manual_assets_only', ROOT / 'scripts/deploy/manual-assets-only.py')
helper = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(helper)
SHA = 'a' * 40
DEST = '/usr/local/libexec/festival-radar/'
RELEASE = '/opt/festival-radar/releases/' + SHA
CURRENT = '/opt/festival-radar/current'


class HostFixture:
    """Model root/app ownership without root access or touching host paths."""
    def __init__(self):
        self.entries = {}
        self.links = {CURRENT: RELEASE}
        self.add(CURRENT, 0, 0, stat.S_IFLNK | 0o777)
        for name in ('/', '/opt', '/opt/festival-radar', '/opt/festival-radar/releases',
                     '/usr', '/usr/local', '/usr/local/libexec', DEST.rstrip('/'),
                     '/etc', '/etc/systemd', '/etc/systemd/system'):
            self.add(name, 0, 0, stat.S_IFDIR | 0o755)
        for name in ('', '/scripts', '/scripts/deploy', '/lib', '/lib/catalog', '/.runtime'):
            self.add(RELEASE + name, 33, 33, stat.S_IFDIR | 0o755)
        self.add(RELEASE + '/DEPLOYED_COMMIT', 33, 33, stat.S_IFREG | 0o644, (SHA + '\n').encode())
        self.add(RELEASE + '/.runtime/node', 33, 33, stat.S_IFREG | 0o755, b'node')
        self.manifest = {'assets': {}, 'release': {}, 'unit': hashlib.sha256(b'unit').hexdigest()}
        self.add('/etc/systemd/system/festival-radar-logo-import@.service', 0, 0, stat.S_IFREG | 0o644, b'unit')
        for name in helper.ASSETS:
            data = name.encode()
            self.manifest['assets'][name] = hashlib.sha256(data).hexdigest()
            self.add(DEST + name, 0, 0, stat.S_IFREG | (0o644 if name == 'verify-logo-restore-proof.py' else 0o755), data)
        for name in helper.RELEASE_FILES:
            data = name.encode()
            self.manifest['release'][name] = hashlib.sha256(data).hexdigest()
            self.add(RELEASE + '/' + name, 33, 33, stat.S_IFREG | 0o644, data)
        self.add(DEST + 'DEPLOYMENT_ASSETS_COMMIT', 0, 0, stat.S_IFREG | 0o644, (SHA + '\n').encode())

    def add(self, name, uid, gid, mode, data=b''):
        self.entries[name] = [os.stat_result((mode, len(self.entries), 1, 1, uid, gid, len(data), 0, 0, 0)), data]

    def metadata(self, name):
        return self.entries[str(name)][0]

    def change(self, name, field, value):
        values = list(self.metadata(name))
        values[field] = value
        self.entries[name][0] = os.stat_result(values)

    def verify(self, after=True):
        fixture = self
        class FakePath:
            def __init__(self, name): self.name = str(name)
            def lstat(self):
                try: return fixture.metadata(self.name)
                except KeyError: raise FileNotFoundError(self.name)
            def resolve(self, strict=False): return fixture.links[self.name]
            def __str__(self): return self.name
        def open_file(entry, flags):
            assert flags & os.O_NOFOLLOW
            return str(entry)
        def fdopen(name, mode):
            stream = io.BytesIO(self.entries[name][1])
            stream.fileno = lambda: name
            return stream
        with patch.object(helper, 'Path', FakePath), patch.object(helper.os, 'getuid', return_value=1001), \
             patch('pwd.getpwnam', side_effect=lambda name: types.SimpleNamespace(
                 pw_uid=1001 if name == 'festival-radar-deploy' else 33, pw_gid=33)), \
             patch.object(helper.os, 'readlink', side_effect=lambda path: self.links[str(path)]), \
             patch.object(helper.os, 'open', side_effect=open_file), patch.object(helper.os, 'fdopen', side_effect=fdopen), \
             patch.object(helper.os, 'fstat', side_effect=self.metadata):
            helper.remote_verify(SHA, self.manifest, after)


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.body = dict(status='ok', database='ok', catalog='database', commit=SHA)

    def test_exact_healthy_json(self):
        helper.validate_health(json.dumps(self.body).encode(), SHA)

    def test_unhealthy_or_wrong_commit(self):
        for key in self.body:
            with self.subTest(key=key), self.assertRaises(ValueError):
                helper.validate_health(json.dumps({**self.body, key: 'wrong'}), SHA)

    def test_malformed_ambiguous_and_oversized_json(self):
        for raw in ('{', '[]', 'null', '{}', json.dumps(self.body) + '{}',
                    json.dumps(self.body)[:-1] + ',"commit":"wrong"}',
                    json.dumps({**self.body, 'value': float('nan')}), ' ' * 65537):
            with self.subTest(raw=raw[:80]), self.assertRaises(ValueError):
                helper.validate_health(raw, SHA)


class HostTests(unittest.TestCase):
    def test_valid_before_and_after(self):
        host = HostFixture()
        host.verify(False)
        host.verify(True)

    def test_missing_dispatcher_allowed_only_before_upgrade(self):
        host = HostFixture()
        del host.entries[DEST + 'start-logo-import']
        host.verify(False)
        with self.assertRaises(FileNotFoundError): host.verify(True)

    def test_old_updater_allowed_before_but_not_after(self):
        host = HostFixture()
        host.entries[DEST + 'upgrade-deployment-assets'][1] = b'older updater'
        host.verify(False)
        with self.assertRaises(ValueError): host.verify(True)

    def test_every_required_path_must_exist(self):
        for name in HostFixture().entries:
            with self.subTest(name=name):
                host = HostFixture()
                del host.entries[name]
                with self.assertRaises(FileNotFoundError): host.verify()

    def test_unsafe_existing_destinations_rejected_before_privileged_writes(self):
        for name in (*helper.ASSETS, 'DEPLOYMENT_ASSETS_COMMIT'):
            for field, value in ((0, stat.S_IFLNK | 0o777), (4, 1001), (0, stat.S_IFREG | 0o666)):
                with self.subTest(name=name, field=field):
                    host = HostFixture()
                    host.change(DEST + name, field, value)
                    with self.assertRaises(ValueError): host.verify(False)
        host = HostFixture()
        host.entries[DEST + 'DEPLOYMENT_ASSETS_COMMIT'][1] = b'malformed\n'
        with self.assertRaises(ValueError): host.verify(False)

    def test_every_regular_file_and_parent_rejects_symlink_owner_permissions(self):
        original = HostFixture()
        for name, (metadata, _) in original.entries.items():
            if name == CURRENT: continue
            for field, value in ((0, stat.S_IFLNK | 0o777), (4, 1001), (5, 1001),
                                 (0, metadata.st_mode | 0o022), (0, metadata.st_mode | 0o4000)):
                with self.subTest(name=name, field=field, value=value):
                    host = HostFixture()
                    host.change(name, field, value)
                    with self.assertRaises(ValueError): host.verify()

    def test_current_must_be_root_symlink_to_exact_release(self):
        for field, value in ((0, stat.S_IFDIR | 0o755), (4, 1001), (5, 1001)):
            host = HostFixture()
            host.change(CURRENT, field, value)
            with self.assertRaises(ValueError): host.verify(False)
        for target in (RELEASE + '/', '/opt/festival-radar/releases/' + 'b' * 40, '/tmp/release'):
            host = HostFixture()
            host.links[CURRENT] = target
            with self.assertRaises(ValueError): host.verify(False)

    def test_all_digests_and_markers_reject_changed_bytes(self):
        original = HostFixture()
        files = [DEST + name for name in helper.ASSETS]
        files += [RELEASE + '/' + name for name in helper.RELEASE_FILES]
        files += [RELEASE + '/DEPLOYED_COMMIT', DEST + 'DEPLOYMENT_ASSETS_COMMIT',
                  '/etc/systemd/system/festival-radar-logo-import@.service']
        for name in files:
            with self.subTest(name=name):
                host = HostFixture()
                host.entries[name][1] += b'\n'
                with self.assertRaises(ValueError): host.verify()

    def test_wrong_ssh_identity(self):
        with patch.object(helper.os, 'getuid', return_value=0), \
             patch('pwd.getpwnam', return_value=types.SimpleNamespace(pw_uid=1001)):
            with self.assertRaises(ValueError): helper.remote_verify(SHA, {}, False)

    def test_atime_change_from_read_is_safe(self):
        host = HostFixture()
        original = host.metadata
        calls = {}
        def metadata(name):
            name = str(name)
            calls[name] = calls.get(name, 0) + 1
            values = list(original(name))
            values[7] = calls[name]  # atime changes on each access
            return os.stat_result(values)
        host.metadata = metadata
        host.verify()

    def test_file_replacement_during_open_fails(self):
        host = HostFixture()
        original = host.metadata
        calls = {}
        def metadata(name):
            name = str(name)
            calls[name] = calls.get(name, 0) + 1
            values = list(original(name))
            if name == DEST + 'start-logo-import' and calls[name] > 1:
                values[1] += 1  # fstat sees a replacement inode
            return os.stat_result(values)
        host.metadata = metadata
        with self.assertRaises(ValueError): host.verify()


class OrchestrationTests(unittest.TestCase):
    def exercise(self, failure=None, env=None):
        events = []
        def gate(label):
            events.append(label)
            if label == failure: raise ValueError('private raw details')
        def run(command, payload=None):
            if command == ['git', 'rev-parse', 'HEAD']: return (SHA + '\n').encode()
            self.assertEqual(command, ['ssh', 'production', 'sudo', '-n', DEST + 'upgrade-deployment-assets', SHA])
            gate('sudo')
            return b''
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main',
                                     'GITHUB_SHA': SHA, **(env or {})}), patch.object(sys, 'argv', ['helper']), \
             patch.object(helper, 'manifest_for', return_value={}), patch.object(helper, 'run', side_effect=run), \
             patch.object(helper, 'health', side_effect=lambda _: gate('health')), \
             patch.object(helper, 'verify_remote', side_effect=lambda c, m, after: gate('post' if after else 'pre')), \
             patch('builtins.print'):
            if failure or env:
                with self.assertRaises(ValueError): helper.main()
            else: helper.main()
        return events

    def test_exact_order_one_privileged_call(self):
        self.assertEqual(self.exercise(), ['health', 'pre', 'sudo', 'post', 'health'])

    def test_failures_stop_without_retry_or_fallback(self):
        for failure, expected in [('health', ['health']), ('pre', ['health', 'pre']),
                                  ('sudo', ['health', 'pre', 'sudo']), ('post', ['health', 'pre', 'sudo', 'post'])]:
            self.assertEqual(self.exercise(failure), expected)

    def test_invalid_dispatch_ref_or_sha_stops_before_network(self):
        for env in ({'GITHUB_REF': 'refs/heads/topic'}, {'GITHUB_EVENT_NAME': 'push'},
                    {'GITHUB_SHA': '$(bad)'}, {'GITHUB_SHA': 'A' * 40}):
            self.assertEqual(self.exercise(env=env), [])

    def test_checkout_mismatch(self):
        with patch.dict(os.environ, {'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_REF': 'refs/heads/main',
                                     'GITHUB_SHA': SHA}), patch.object(sys, 'argv', ['helper']), \
             patch.object(helper, 'run', return_value=b'wrong\n') as run:
            with self.assertRaises(ValueError): helper.main()
            self.assertEqual(run.call_count, 1)

    def test_remote_payload_is_unprivileged_and_quiet(self):
        with patch.object(helper, 'run', return_value=b'') as run:
            helper.verify_remote(SHA, HostFixture().manifest, True)
            command, payload = run.call_args.args
            self.assertEqual(command, ['ssh', 'production', 'python3', '-'])
            compile(payload, '<remote verifier>', 'exec')
            self.assertNotIn(b'subprocess', payload)
            self.assertNotIn(b'systemctl', payload)
        with patch.object(helper, 'run', return_value=b'unexpected output'):
            with self.assertRaises(ValueError): helper.verify_remote(SHA, {}, False)

    def test_fixed_https_url_and_no_redirect(self):
        with patch.object(helper, 'run', return_value=b'{}') as run:
            with self.assertRaises(ValueError): helper.health(SHA)
            command = run.call_args.args[0]
            self.assertEqual(command[-1], helper.HEALTH_URL)
            self.assertIn('--fail', command)
            self.assertEqual(command[command.index('--proto') + 1], '=https')
            self.assertNotIn('--location', command)


class ContractTests(unittest.TestCase):
    def test_manifest_is_exact_git_content_and_unit(self):
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip()
        # Model a commit containing the reviewable working files: this test also
        # runs before commits exist. Assert every read requests the exact SHA.
        def source(command, payload=None):
            self.assertEqual(command[:2], ['git', 'show'])
            self.assertTrue(command[2].startswith(commit + ':'))
            return (ROOT / command[2].split(':', 1)[1]).read_bytes()
        with patch.object(helper, 'run', side_effect=source):
            manifest = helper.manifest_for(commit)
        for name, digest in manifest['assets'].items():
            self.assertEqual(digest, hashlib.sha256((ROOT / 'scripts/deploy' / name).read_bytes()).hexdigest())
        self.assertEqual(set(manifest['assets']), set(helper.ASSETS))
        self.assertEqual(set(manifest['release']), set(helper.RELEASE_FILES))
        self.assertRegex(manifest['unit'], '^[0-9a-f]{64}$')
        installer = (ROOT / 'scripts/deploy/install-release.sh').read_text()
        raw_unit = installer.split('cat > "/etc/systemd/system/$service-logo-import@.service" <<UNIT\n', 1)[1].split('\nUNIT\n', 1)[0]
        # Let bash expand the actual installer heredoc, without running installer.
        unit = subprocess.check_output(['bash', '-c',
            'service=festival-radar; app_root=/opt/festival-radar; shared=$app_root/shared; cat <<UNIT\n' + raw_unit + '\nUNIT\n'])
        self.assertEqual(manifest['unit'], hashlib.sha256(unit).hexdigest())

    def test_workflow_fixed_reviewed_contract(self):
        workflow = (ROOT / '.github/workflows/deployment-assets-only.yml').read_text()
        self.assertRegex(workflow, r'on:\n  workflow_dispatch:\n\nconcurrency:')
        self.assertIn("if: github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch'", workflow)
        for value in ('environment: production', 'group: festival-radar-production', 'cancel-in-progress: false',
                      'contents: read', 'actions/checkout@v4', 'ref: ${{ github.sha }}', 'persist-credentials: false',
                      'User festival-radar-deploy', 'StrictHostKeyChecking yes', 'BatchMode yes',
                      'bash scripts/deploy/preflight-ssh.sh production', 'python3 scripts/deploy/manual-assets-only.py',
                      'if: always()'):
            self.assertIn(value, workflow)
        self.assertEqual(set(re.findall(r'secrets\.([A-Z_]+)', workflow)),
                         {'DEPLOY_HOST', 'DEPLOY_KNOWN_HOSTS', 'DEPLOY_PORT', 'DEPLOY_SSH_KEY'})
        self.assertNotRegex(workflow, r'inputs:|sudo|scp|workflow_call|schedule:|DATABASE_URL')
        script = (ROOT / 'scripts/deploy/manual-assets-only.py').read_text()
        self.assertEqual(script.count("'sudo'"), 1)
        self.assertNotIn('shell=True', script)

    def test_ssh_config_rejects_injection_without_logging_secrets(self):
        workflow = (ROOT / '.github/workflows/deployment-assets-only.yml').read_text()
        setup = textwrap.dedent(workflow.split('        run: |\n', 1)[1].split('      - name:', 1)[0])
        for host, port, success in [('example.invalid', '22', True), ('example.invalid', '0022', True),
                                    ('host\nUser root', '22', False), ('-host', '22', False),
                                    ('host', '22\nProxyCommand bad', False), ('host', '0', False),
                                    ('host', '65536', False), ('host', '999999', False)]:
            with self.subTest(host=host, port=port), tempfile.TemporaryDirectory() as temporary:
                env = {**os.environ, 'HOME': temporary, 'DEPLOY_HOST': host, 'DEPLOY_PORT': port,
                       'DEPLOY_SSH_KEY': 'private-fixture', 'DEPLOY_KNOWN_HOSTS': 'known-fixture'}
                result = subprocess.run(['bash', '-c', setup], env=env, capture_output=True)
                self.assertEqual(result.returncode == 0, success)
                self.assertEqual(result.stdout + result.stderr, b'')
                if success:
                    for name in ('deploy_key', 'known_hosts', 'config'):
                        self.assertEqual(stat.S_IMODE((Path(temporary) / '.ssh' / name).stat().st_mode), 0o600)

    def test_existing_installer_and_updater_permission_contract(self):
        installer = (ROOT / 'scripts/deploy/install-release.sh').read_text()
        packager = (ROOT / 'scripts/deploy/package-release.sh').read_text()
        updater = (ROOT / 'scripts/deploy/upgrade-deployment-assets').read_text()
        self.assertIn('chown -R www-data:www-data "$release" "$shared"', installer)
        self.assertIn('rm -rf "$release"', installer)
        self.assertIn('ln -sfn "$release" "$app_root/current"', installer)
        self.assertIn('> "$stage/app/DEPLOYED_COMMIT"', packager)
        self.assertIn('run-reviewed-logo-import.ts', packager)
        self.assertIn('cp -a data lib', packager)
        self.assertIn('for asset in ' + ' '.join(helper.ASSETS), updater)
        self.assertIn('install -o root -g root -m "$asset_mode"', updater)
        self.assertIn('asset_mode=0644', updater)
        self.assertIn('[[ "$main_sha" == "$commit" ]]', updater)
        self.assertNotRegex(updater, r'systemctl|migrate|activate-release "|install-release.sh "')


if __name__ == '__main__':
    unittest.main()
