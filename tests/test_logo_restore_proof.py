"""Policy tests use synthetic artifacts and local temp paths ONLY, never production.

Synthetic pins are patched in the imported module for policy branch coverage.
The root CLI has no override flags/environment and trusts only its hardcoded pins.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/deploy/verify-logo-restore-proof.py'
spec = importlib.util.spec_from_file_location('logo_restore_proof', SCRIPT)
proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proof)


class RestoreProofTests(unittest.TestCase):
    def setUp(self):
        self.now = proof.BACKUP_AT + 60
        clock = patch.object(proof.time, 'time', return_value=self.now)
        clock.start()
        self.addCleanup(clock.stop)
        self.commit = proof.ARTIFACT_RELEASE
        self.archive = b'PGDMPsynthetic disposable policy fixture'
        counts = {f'Table{i}': i for i in range(36)}
        counts.update(proof.REQUIRED_COUNTS)
        self.manifest = {'archiveSha256': proof.digest(self.archive), 'archive': str(proof.ARCHIVE), 'blobRows': 0, 'logoRows': 0, 'tables': 42, 'counts': [[name, count] for name, count in counts.items()],
            'countsSha256': proof.COUNTS_DIGEST, 'schema': {'constraints': ['synthetic'], 'indexes': ['synthetic']},
            'schemaSha256': proof.SCHEMA_DIGEST, 'parity': True, 'release': self.commit}

    def artifacts(self, manifest=None, archive=None, pin_manifest=True):
        raw = proof.canonical(self.manifest if manifest is None else manifest)
        archive = self.archive if archive is None else archive
        def read(path, limit, private=False):
            self.assertTrue(private)
            self.assertIn(path, (proof.ARCHIVE, proof.MANIFEST))
            return archive if path == proof.ARCHIVE else raw
        patches = [patch.object(proof, 'ARCHIVE_SIZE', len(self.archive)),
                   patch.object(proof, 'ARCHIVE_DIGEST', proof.digest(self.archive)),
                   patch.object(proof, 'read_regular', side_effect=read)]
        if pin_manifest:
            patches.append(patch.object(proof, 'MANIFEST_DIGEST', proof.digest(raw)))
        from contextlib import ExitStack
        stack = ExitStack()
        for item in patches:
            stack.enter_context(item)
        return stack

    def test_trust_only_independently_pinned_successful_archive(self):
        self.assertIn('T132404Z-7a8a3d93.dump', str(proof.ARCHIVE))
        self.assertNotIn('T132256Z-e3ff210e', str(proof.ARCHIVE))
        self.assertEqual(proof.MANIFEST, proof.ARCHIVE.with_suffix('.manifest.json'))
        self.assertEqual(proof.MANIFEST.name, 'festival_radar-pre-logo-20261005T132404Z-7a8a3d93.manifest.json')
        self.assertEqual(proof.MANIFEST_DIGEST, 'd332e79d0b6169856f819b3c9fd675f31e5499daa3831588e434495542126079')
        self.assertEqual(proof.MAX_BACKUP_AGE, 1800)
        with self.artifacts():
            proof.verify_artifacts(self.commit, self.now)
        for archive in (b'PGDMPfailed archive', self.archive + b'changed', b'not a dump'):
            with self.artifacts(archive=archive), self.assertRaises(ValueError):
                proof.verify_artifacts(self.commit, self.now)
        with self.artifacts(pin_manifest=False), self.assertRaises(ValueError):
            proof.verify_artifacts(self.commit, self.now)

    def test_future_deployment_cannot_reuse_historical_release_or_refresh_age(self):
        with self.artifacts():
            for sha, now in [('a' * 40, self.now), (self.commit, proof.BACKUP_AT - 1),
                             (self.commit, proof.BACKUP_AT + proof.MAX_BACKUP_AGE)]:
                with self.assertRaises(ValueError):
                    proof.verify_artifacts(sha, now)
        with self.assertRaises(ValueError):
            proof.proof_record('a' * 40, self.now)

    def test_manifest_shape_counts_schema_and_false_restore_parity_fail_closed(self):
        pairs = self.manifest['counts']
        changed_count = lambda name, count: [[key, count if key == name else value] for key, value in pairs]
        for key, value in [('release', 'a' * 40), ('parity', False), ('parity', 1),
            ('archive', str(proof.ARCHIVE.with_name('failed.dump'))),
            ('tables', 41), ('tables', True), ('blobRows', 1), ('blobRows', False),
            ('logoRows', 1), ('logoRows', False),
            ('countsSha256', 'f' * 64), ('schemaSha256', 'f' * 64), ('archiveSha256', 'f' * 64),
            ('schema', {}), ('schema', ['not an object']), ('schema', 'not an object'),
            ('counts', dict(pairs)), ('counts', pairs + [['unexpected', 0]]),
            ('counts', pairs[:-1] + [pairs[0]]), ('counts', pairs[:-1] + [['MissingCount']]),
            ('counts', pairs[:-1] + [['../unsafe', 0]]),
            ('counts', changed_count('Festival', 51)),
            ('counts', changed_count('FestivalLogo', False)),
            ('counts', changed_count('FestivalLogo', -1)),
            ('counts', changed_count('Artist', 2**53)),
            ('counts', changed_count('Artist', '202'))]:
            changed = {**self.manifest, key: value}
            with self.artifacts(changed), self.assertRaises(ValueError):
                proof.verify_artifacts(self.commit, self.now)
        with self.artifacts({**self.manifest, 'caller_attested': True}), self.assertRaises(ValueError):
            proof.verify_artifacts(self.commit, self.now)
        for key in self.manifest:
            with self.artifacts({k: v for k, v in self.manifest.items() if k != key}), self.assertRaises(ValueError):
                proof.verify_artifacts(self.commit, self.now)
        for raw in (b'{"parity":false,"parity":true}', b'{}\0', b'{}\n{}', b'{"value":NaN}', b'\xff'):
            with self.assertRaises((ValueError, UnicodeError)):
                proof.parse_json(raw)

    def test_root_audit_parser_rejects_original_bad_bytes_before_shell_normalization(self):
        record = {'status': 'ok', 'release': self.commit, 'inventoryDigest': proof.INVENTORY_DIGEST,
                  'proofDigest': 'b' * 64, 'expiresAt': self.now + 300}
        raw = ('LOGO_RESTORE_PROOF ' + json.dumps(record, separators=(',', ':')) + '\n').encode()
        self.assertEqual(proof.validate_audit(raw, self.commit, self.now).encode() + b'\n', raw)
        for bad in (raw + b'\n', raw + raw, raw + b'\0', raw.replace(b'"status"', b'\0"status"'),
                    raw[:-1], raw + b'secret URL', raw.replace(b'"status":"ok"', b'"status":"failed","status":"ok"'),
                    raw.replace(b'"status":"ok"', b'"status": "ok"'), b'x' * 513):
            with self.assertRaises(ValueError):
                proof.validate_audit(bad, self.commit, self.now)
        for field, value in [('release', 'f' * 40), ('inventoryDigest', 'f' * 64), ('proofDigest', 'secret'),
                             ('expiresAt', self.now), ('expiresAt', self.now + 301), ('expiresAt', True), ('extra', 1)]:
            bad = ('LOGO_RESTORE_PROOF ' + json.dumps({**record, field: value}, separators=(',', ':')) + '\n').encode()
            with self.assertRaises(ValueError):
                proof.validate_audit(bad, self.commit, self.now)

    def test_canonical_proof_digest_freshness_all_fields_and_audit_injection(self):
        record = proof.proof_record(self.commit, self.now)
        raw = proof.canonical(record)
        proof.validate_proof(raw, self.commit, proof.digest(raw), self.now)
        for key, value in [('release', 'a' * 40), ('inventoryDigest', 'a' * 64), ('parity', False),
            ('sourceFiles', 46), ('tableCount', 41), ('archiveSha256', 'a' * 64),
            ('manifestSha256', 'a' * 64), ('backupAt', self.now), ('verifiedAt', str(self.now)),
            ('expiresAt', self.now + 301), ('extra', 'secret URL')]:
            bad = proof.canonical({**record, key: value})
            with self.assertRaises(ValueError):
                proof.validate_proof(bad, self.commit, proof.digest(bad), self.now)
        for bad in (raw + b'\n', raw + raw, raw + b'\0', raw.replace(b'"parity":true', b'"parity":false,"parity":true')):
            with self.assertRaises(ValueError):
                proof.validate_proof(bad, self.commit, proof.digest(bad), self.now)
        for now in (self.now - 1, record['expiresAt']):
            with self.assertRaises(ValueError):
                proof.validate_proof(raw, self.commit, proof.digest(raw), now)
        with self.assertRaises(ValueError):
            proof.validate_proof(raw, self.commit, 'f' * 64, self.now)

    def test_private_files_and_source_reject_symlinks_nonregular_and_forged_unprivileged_proof(self):
        with tempfile.TemporaryDirectory(prefix='logo-root-proof-test-') as directory:
            path = Path(directory) / 'proof.json'
            path.write_bytes(b'{}')
            path.chmod(0o600)
            self.assertEqual(proof.read_regular(path, 32), b'{}')
            link = Path(directory) / 'symlink'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                proof.read_regular(link, 32)
            parent_link = Path(directory) / 'directory-link'
            parent_link.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(OSError):
                proof.read_regular(parent_link / 'proof.json', 32)
            fifo = Path(directory) / 'fifo'
            os.mkfifo(fifo)
            with self.assertRaises(ValueError):
                proof.read_regular(fifo, 32)
            if os.getuid() != 0:
                with self.assertRaises(ValueError):
                    proof.read_regular(path, 32, private=True)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                proof.read_regular(path, 32, private=True)

    def test_current_release_source_hash_exact_inventory_and_marker(self):
        root = SCRIPT.parents[2]
        with tempfile.TemporaryDirectory(prefix='logo-source-proof-test-') as directory:
            release_root = Path(directory) / 'releases'
            release = release_root / self.commit
            (release / 'data').mkdir(parents=True)
            (release / 'public').mkdir()
            import shutil
            shutil.copyfile(root / 'data/reviewed-logo-inventory.json', release / 'data/reviewed-logo-inventory.json')
            shutil.copytree(root / 'public/logos', release / 'public/logos')
            (release / 'DEPLOYED_COMMIT').write_text(self.commit + '\n')
            assets = Path(directory) / 'assets'
            assets.mkdir()
            (assets / 'DEPLOYMENT_ASSETS_COMMIT').write_text(self.commit + '\n')
            current = Path(directory) / 'current'
            current.symlink_to(release, target_is_directory=True)
            with patch.object(proof, 'RELEASE_ROOT', release_root), patch.object(proof, 'ASSETS_ROOT', assets), patch.object(proof, 'CURRENT', current):
                proof.verify_source(self.commit)
                source = next((release / 'public/logos').iterdir())
                source.write_bytes(b'changed')
                with self.assertRaises(ValueError):
                    proof.verify_source(self.commit)
                shutil.copyfile(root / 'public/logos' / source.name, source)
                inventory = release / 'data/reviewed-logo-inventory.json'
                rows = json.loads(inventory.read_text())
                rows[0]['sha256'] = 'f' * 64
                inventory.write_text(json.dumps(rows))
                with self.assertRaises(ValueError):
                    proof.verify_source(self.commit)
                shutil.copyfile(root / 'data/reviewed-logo-inventory.json', inventory)
                (release / 'DEPLOYED_COMMIT').write_text('a' * 40 + '\n')
                with self.assertRaises(ValueError):
                    proof.verify_source(self.commit)

    def test_apply_rechecks_root_artifacts_and_source_not_only_proof_digest(self):
        raw = proof.canonical(proof.proof_record(self.commit, self.now))
        with patch.object(proof, 'read_regular', return_value=raw), patch.object(proof, 'verify_artifacts') as artifacts, patch.object(proof, 'verify_source') as source:
            self.assertEqual(proof.check(self.commit, proof.digest(raw), self.now), 'LOGO_RESTORE_PROOF_VALID')
            artifacts.assert_called_once_with(self.commit, self.now)
            source.assert_called_once_with(self.commit)
            artifacts.side_effect = ValueError('raw secret URL')
            with self.assertRaises(ValueError):
                proof.check(self.commit, proof.digest(raw), self.now)
        with patch.object(proof, 'read_regular', return_value=raw), patch.object(proof, 'verify_artifacts'), patch.object(proof, 'verify_source', side_effect=ValueError()):
            with self.assertRaises(ValueError):
                proof.check(self.commit, proof.digest(raw), self.now)

    def test_issue_writes_only_verified_canonical_proof_and_does_not_refresh_backup_age(self):
        at = proof.BACKUP_AT + proof.MAX_BACKUP_AGE - 60
        expected = proof.canonical(proof.proof_record(self.commit, at))
        with patch.object(proof.time, 'time', return_value=at), patch.object(proof, 'verify_artifacts') as artifacts, patch.object(proof, 'verify_source') as source, patch.object(proof, 'write_proof') as write, patch.object(proof, 'read_regular', return_value=expected):
            audit = proof.issue(self.commit, at)
            artifacts.assert_called_once_with(self.commit, at)
            source.assert_called_once_with(self.commit)
            write.assert_called_once_with(expected)
            record = json.loads(audit.removeprefix('LOGO_RESTORE_PROOF '))
            self.assertEqual(record['proofDigest'], proof.digest(expected))
            self.assertEqual(record['expiresAt'], proof.BACKUP_AT + proof.MAX_BACKUP_AGE)
        with patch.object(proof, 'verify_artifacts', side_effect=ValueError()), patch.object(proof, 'write_proof') as write:
            with self.assertRaises(ValueError):
                proof.issue(self.commit, at)
            write.assert_not_called()
        with patch.object(proof, 'verify_artifacts'), patch.object(proof, 'verify_source'), patch.object(proof, 'write_proof'), patch.object(proof, 'read_regular', return_value=b'bad read-back'):
            with self.assertRaises(ValueError):
                proof.issue(self.commit, self.now)

    def test_apply_rejects_expiry_during_source_verification(self):
        record = proof.proof_record(self.commit, self.now)
        raw = proof.canonical(record)
        with patch.object(proof, 'read_regular', return_value=raw), patch.object(proof, 'verify_artifacts'), patch.object(proof, 'verify_source'), patch.object(proof.time, 'time', return_value=record['expiresAt']):
            with self.assertRaises(ValueError):
                proof.check(self.commit, proof.digest(raw), self.now)

    def test_atomic_cache_write_is_private_and_failed_replace_preserves_previous_proof(self):
        # Model a root-owned directory's metadata without requiring privileged CI.
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory(prefix='logo-cache-test-') as directory:
            folder = Path(directory) / 'proofs'
            folder.mkdir(mode=0o700)
            file = folder / 'proof.json'
            actual_lstat = Path.lstat
            def metadata(path):
                if path == folder:
                    return SimpleNamespace(st_mode=0o40700, st_uid=0, st_gid=0)
                return actual_lstat(path)
            with patch.object(proof, 'PROOF_DIR', folder), patch.object(proof, 'PROOF_FILE', file), patch.object(Path, 'lstat', metadata):
                proof.write_proof(b'first verified fixture')
                self.assertEqual(file.read_bytes(), b'first verified fixture')
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
                with patch.object(proof.os, 'replace', side_effect=OSError('secret path')):
                    with self.assertRaises(OSError):
                        proof.write_proof(b'second verified fixture')
                self.assertEqual(file.read_bytes(), b'first verified fixture')
                self.assertEqual(list(folder.iterdir()), [file])

    def test_cli_has_no_path_pin_clock_or_freshness_overrides_and_sanitizes_failure(self):
        for args in (['bad-mode', self.commit], ['issue', 'main'], ['issue', self.commit, '/tmp/forged'],
                     ['check', self.commit, 'secret URL'], ['issue', 'a' * 40]):
            child = subprocess.run(['/usr/bin/python3', '-I', str(SCRIPT), *args], capture_output=True)
            self.assertNotEqual(child.returncode, 0)
            self.assertEqual(child.stdout, b'')
            self.assertEqual(child.stderr, b'logo restore proof rejected\n')


if __name__ == '__main__':
    unittest.main()
