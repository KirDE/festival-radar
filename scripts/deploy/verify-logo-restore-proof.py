#!/usr/bin/python3
"""Root-only, read-only verification of the ONE independently proven restore.

Never rebind the historical manifest to a new release or refresh its backup age.
No DB credentials, app code execution, SQL, restore, arbitrary path or URL input.
A new deployed SHA requires independently verified post-deploy artifacts and a
reviewed update to these immutable pins. CLI output is an exact allowlist.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time

INVENTORY_DIGEST = '99a2e164672883036310fd14639be96519a5e0765d770699bfeb98a1b06db456'
ARCHIVE = Path('/var/backups/festival-radar/festival_radar-pre-logo-20261005T132404Z-7a8a3d93.dump')
MANIFEST = ARCHIVE.with_suffix('.manifest.json')
ARCHIVE_SIZE = 478057
ARCHIVE_DIGEST = '9a29dc474f7fef612dc420c3a7928900c79203345a6f9e282d14206c40b53f20'
MANIFEST_DIGEST = 'd332e79d0b6169856f819b3c9fd675f31e5499daa3831588e434495542126079'
COUNTS_DIGEST = '2ef57ad05d33e5e582820463b3c07ac8e90b0b69639c0be16283d0fc45c34b0c'
SCHEMA_DIGEST = '50bc36dd35b2cbc81e18fbbc1a2b3fd6f00a31f9d87c87cd8bea556e21c6ddea'
ARTIFACT_RELEASE = '50402487d1fbb6a0d1fc5aa4526acaf664dc8e4f'
BACKUP_AT = int(datetime.datetime(2026, 10, 5, 13, 24, 4, tzinfo=datetime.timezone.utc).timestamp())
MAX_BACKUP_AGE = 1800
PROOF_TTL = 300
PROOF_DIR = Path('/run/festival-radar-logo-restore-proof')
PROOF_FILE = PROOF_DIR / 'proof.json'
RELEASE_ROOT = Path('/opt/festival-radar/releases')
ASSETS_ROOT = Path('/usr/local/libexec/festival-radar')
CURRENT = Path('/opt/festival-radar/current')
REQUIRED_COUNTS = {'Festival': 52, 'FestivalEdition': 53, 'Artist': 202,
                   'FestivalSource': 53, 'FestivalLogo': 0, 'AssetBlob': 0}


def require(condition):
    if not condition:
        raise ValueError('logo restore proof rejected')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode('ascii')


def parse_json(data):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result)
            result[key] = value
        return result
    require(b'\0' not in data)
    return json.loads(data.decode('utf-8', errors='strict'), object_pairs_hook=unique,
                      parse_constant=lambda _: require(False))


def read_regular(path, limit, private=False):
    """Walk and read descriptors without following any component symlink.

    Private artifacts require root:root, 0600, one link, and root-owned parents
    that are not writable by other users. App-owned source is authenticated by
    pinned hashes instead; never execute it as root.
    """
    parts = Path(path).parts
    require(parts[0] == '/' and all(p not in ('.', '..') for p in parts[1:]))
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = next_fd
            if private:
                info = os.fstat(directory)
                require(info.st_uid == 0 and info.st_gid == 0 and not stat.S_IMODE(info.st_mode) & 0o022)
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= limit)
            if private:
                require(before.st_uid == 0 and before.st_gid == 0 and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1)
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                data = stream.read(limit + 1)
            after = os.fstat(fd)
            require(len(data) == before.st_size and len(data) <= limit and
                    (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                    (after.st_size, after.st_mtime_ns, after.st_ctime_ns))
            return data
        finally:
            os.close(fd)
    finally:
        os.close(directory)


def verify_artifacts(commit, now):
    require(commit == ARTIFACT_RELEASE)
    require(type(now) is int and BACKUP_AT <= now < BACKUP_AT + MAX_BACKUP_AGE)
    archive = read_regular(ARCHIVE, ARCHIVE_SIZE, private=True)
    require(len(archive) == ARCHIVE_SIZE and archive.startswith(b'PGDMP') and digest(archive) == ARCHIVE_DIGEST)
    raw = read_regular(MANIFEST, 1_048_576, private=True)
    require(digest(raw) == MANIFEST_DIGEST)
    manifest = parse_json(raw)
    require(type(manifest) is dict and set(manifest) == {
        'archive', 'archiveSha256', 'blobRows', 'counts', 'countsSha256',
        'logoRows', 'parity', 'release', 'schema', 'schemaSha256', 'tables'})
    require(manifest['archive'] == str(ARCHIVE) and manifest['release'] == commit and manifest['parity'] is True and
            manifest['archiveSha256'] == ARCHIVE_DIGEST and manifest['countsSha256'] == COUNTS_DIGEST and
            manifest['schemaSha256'] == SCHEMA_DIGEST)
    require(type(manifest['tables']) is int and manifest['tables'] == 42 and
            type(manifest['blobRows']) is int and manifest['blobRows'] == 0 and
            type(manifest['logoRows']) is int and manifest['logoRows'] == 0)
    pairs = manifest['counts']
    require(type(pairs) is list and len(pairs) == 42)
    counts = {}
    for pair in pairs:
        require(type(pair) is list and len(pair) == 2)
        name, count = pair
        require(isinstance(name, str) and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) is not None and
                name not in counts and type(count) is int and 0 <= count <= 2**53 - 1)
        counts[name] = count
    require(all(counts.get(name) == count for name, count in REQUIRED_COUNTS.items()))
    require(type(manifest['schema']) is dict and bool(manifest['schema']))
    # The full immutable manifest hash authenticates the original serialization,
    # all 42 counts and complete schema. Do not invent a new canonicalization for
    # the historical counts/schema digests, or trust a freshly generated manifest.


def verify_source(commit):
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None)
    release = RELEASE_ROOT / commit
    require(CURRENT.resolve(strict=True) == release)
    require(read_regular(release / 'DEPLOYED_COMMIT', 41) == (commit + '\n').encode())
    require(read_regular(ASSETS_ROOT / 'DEPLOYMENT_ASSETS_COMMIT', 41) == (commit + '\n').encode())
    rows = parse_json(read_regular(release / 'data/reviewed-logo-inventory.json', 65536))
    require(type(rows) is list and len(rows) == 47)
    names = set()
    slugs = set()
    lines = []
    for row in rows:
        require(type(row) is dict and set(row) == {'slug', 'file', 'mimeType', 'sizeBytes', 'sha256'})
        slug, name, mime, size, sha = (row[k] for k in ('slug', 'file', 'mimeType', 'sizeBytes', 'sha256'))
        require(isinstance(slug, str) and re.fullmatch(r'[a-z0-9-]+', slug) is not None and
                name == slug + '.png' and mime in ('image/png', 'image/jpeg', 'image/webp') and
                type(size) is int and 0 < size <= 2097152 and isinstance(sha, str) and re.fullmatch(r'[0-9a-f]{64}', sha) is not None)
        require(name not in names and slug not in slugs)
        names.add(name)
        slugs.add(slug)
        lines.append(f'{slug}\t{mime}\t{size}\t{sha}\n')
    require(digest(''.join(lines).encode()) == INVENTORY_DIGEST)
    # A source directory may change while read, but every accepted byte remains
    # authenticated by the immutable digest. The worker repeats full decode/audit.
    require(set(os.listdir(release / 'public/logos')) == names)
    for row in rows:
        data = read_regular(release / 'public/logos' / row['file'], row['sizeBytes'])
        require(len(data) == row['sizeBytes'] and digest(data) == row['sha256'])


def proof_record(commit, verified_at):
    require(commit == ARTIFACT_RELEASE)
    require(BACKUP_AT <= verified_at < BACKUP_AT + MAX_BACKUP_AGE)
    return {'version': 1, 'release': commit, 'inventoryDigest': INVENTORY_DIGEST,
            'archiveSha256': ARCHIVE_DIGEST, 'manifestSha256': MANIFEST_DIGEST,
            'countsSha256': COUNTS_DIGEST, 'schemaSha256': SCHEMA_DIGEST,
            'parity': True, 'sourceFiles': 47, 'tableCount': 42,
            'backupAt': BACKUP_AT, 'verifiedAt': verified_at,
            'expiresAt': min(verified_at + PROOF_TTL, BACKUP_AT + MAX_BACKUP_AGE)}


def validate_proof(raw, commit, expected_digest, now):
    require(re.fullmatch(r'[0-9a-f]{64}', expected_digest) is not None and digest(raw) == expected_digest)
    proof = parse_json(raw)
    require(type(proof) is dict and type(proof.get('verifiedAt')) is int)
    expected = proof_record(commit, proof['verifiedAt'])
    # Byte equality rejects boolean-as-count, alternative types, duplicate fields,
    # extra lines/fields, encoding tricks and noncanonical audit content.
    require(raw == canonical(expected) and proof == expected)
    require(proof['verifiedAt'] <= now < proof['expiresAt'])
    return proof


def write_proof(raw):
    # Root only; private directory is never granted to the app/deploy user.
    try:
        PROOF_DIR.mkdir(mode=0o700)
    except FileExistsError:
        pass
    info = PROOF_DIR.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700)
    fd, temporary = tempfile.mkstemp(prefix='.proof-', dir=PROOF_DIR)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, PROOF_FILE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def issue(commit, now):
    verify_artifacts(commit, now)
    verify_source(commit)
    proof = proof_record(commit, int(time.time()))
    raw = canonical(proof)
    write_proof(raw)
    # Reopen with the same ownership/byte guards as apply. No success on bad write.
    require(read_regular(PROOF_FILE, 2048, private=True) == raw)
    return 'LOGO_RESTORE_PROOF ' + json.dumps({'status': 'ok', 'release': commit,
        'inventoryDigest': INVENTORY_DIGEST, 'proofDigest': digest(raw), 'expiresAt': proof['expiresAt']}, separators=(',', ':'))


def validate_audit(raw, commit, now):
    """Validate original bytes BEFORE any shell newline/NUL normalization."""
    prefix = b'LOGO_RESTORE_PROOF '
    require(0 < len(raw) <= 512 and raw.startswith(prefix))
    record = parse_json(raw[len(prefix):])
    require(type(record) is dict and isinstance(record.get('proofDigest'), str) and
            re.fullmatch(r'[0-9a-f]{64}', record['proofDigest']) is not None and
            type(record.get('expiresAt')) is int and type(now) is int and
            now < record['expiresAt'] <= now + PROOF_TTL)
    expected = {'status': 'ok', 'release': commit, 'inventoryDigest': INVENTORY_DIGEST,
                'proofDigest': record['proofDigest'], 'expiresAt': record['expiresAt']}
    frame = 'LOGO_RESTORE_PROOF ' + json.dumps(expected, separators=(',', ':'))
    require(raw == (frame + '\n').encode('ascii'))
    return frame


def check(commit, expected_digest, now):
    raw = read_regular(PROOF_FILE, 2048, private=True)
    validate_proof(raw, commit, expected_digest, now)
    # Repeat all authoritative checks inside the apply lock, not only in Actions.
    verify_artifacts(commit, now)
    verify_source(commit)
    validate_proof(raw, commit, expected_digest, int(time.time()))
    return 'LOGO_RESTORE_PROOF_VALID'


if __name__ == '__main__':
    try:
        require(os.geteuid() == 0 and os.getegid() == 0 and len(sys.argv) in (3, 4))
        mode, commit = sys.argv[1:3]
        require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None)
        now = int(time.time())  # No environment or caller-supplied clock/freshness.
        if mode == 'issue' and len(sys.argv) == 3:
            output = issue(commit, now)
        elif mode == 'audit' and len(sys.argv) == 3:
            output = validate_audit(sys.stdin.buffer.read(513), commit, now)
        elif mode == 'check' and len(sys.argv) == 4:
            require(re.fullmatch(r'[0-9a-f]{64}', sys.argv[3]) is not None)
            output = check(commit, sys.argv[3], now)
        else:
            raise ValueError('rejected')
        print(output)
    except Exception:
        print('logo restore proof rejected', file=sys.stderr)
        sys.exit(6)
