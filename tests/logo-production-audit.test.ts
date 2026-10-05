import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { festivals } from '../data/festivals.ts';
import { audit, REVIEWED_DIGEST, runLogoImport } from '../scripts/deploy/run-reviewed-logo-import.ts';

const nonce = 'b'.repeat(64);
const rows = festivals.map(({ slug }) => ({ slug }));

test('pinned source preview is read-only and returns bounded audit', async () => {
  const db = { festival: { findMany: async () => rows }, festivalLogo: { findMany: async () => [] },
    assetBlob: { create: () => { throw new Error('write forbidden'); } },
    $transaction: () => { throw new Error('write forbidden'); },
  } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'preview', nonce);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(result.output), { operation: 'reviewed-logo-import', mode: 'preview', nonce,
    status: 'ok', inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47, existing: 0 });
});

test('verify rejects incomplete bindings and never writes', async () => {
  const db = { festivalLogo: { findMany: async () => [] }, $transaction: () => { throw new Error('write forbidden'); } } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'verify', nonce);
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(result.output).status, 'database-rejected');
});

test('database failure is sanitized and invalid nonce fails before access', async () => {
  const db = { festival: { findMany: () => { throw new Error('secret URL password'); } } } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'preview', nonce);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.output, /secret|password|URL/);
  await assert.rejects(runLogoImport(db, 'preview', 'oops'), /Invalid logo operation nonce/);
  assert.throws(() => audit('preview', nonce, 'ok', 48), /Invalid logo audit/);
});

test('direct runner rejects unconfirmed apply before database access', t => {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/deploy/run-reviewed-logo-import.ts', 'apply'],
    { encoding: 'utf8', env: { ...process.env, LOGO_IMPORT_NONCE: nonce, DEPLOYED_COMMIT: 'a'.repeat(40), DATABASE_URL: 'postgresql://ignored:ignored@127.0.0.1/festival_integration' } });
  if (child.error && 'code' in child.error && child.error.code === 'EPERM') { t.skip('sandbox denies nested Node execution; CLI guard checked separately'); return; }
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /logo operation guard rejected/);
  assert.equal(child.stdout, '');
});

test('root dispatcher matches only exact fixed audit records', () => {
  const script = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  const patterns = script.split(String.fromCharCode(10))
    .filter(line => line.startsWith('ok_pattern=') || line.startsWith('fail_pattern='))
    .join(String.fromCharCode(10));
  const base = { operation: 'reviewed-logo-import', mode: 'preview', nonce, status: 'ok', inventoryDigest: REVIEWED_DIGEST, sourceFiles: 47 };
  for (const [record, expected] of [
    [{ ...base, existing: 0 }, 'ok'],
    [{ ...base, status: 'database-rejected' }, 'fail'],
    [{ ...base, existing: 48 }, ''],
    [{ ...base, existing: 0, extra: 'leak' }, ''],
    [{ ...base, nonce: 'a'.repeat(64), existing: 0 }, ''],
  ] as const) {
    const shell = 'mode=preview; nonce=' + nonce + '; ' + patterns + '; ' +
      '[[ "$RECORD" =~ $ok_pattern ]] && echo ok; [[ "$RECORD" =~ $fail_pattern ]] && echo fail';
    const result = spawnSync('bash', ['-c', shell], { encoding: 'utf8',
      env: { ...process.env, RECORD: 'LOGO_IMPORT_AUDIT ' + JSON.stringify(record) } });
    assert.equal(result.stdout.trim(), expected);
  }
});

test('invalid mode and unconfirmed apply reject before source/database access', async () => {
  const db = {} as PrismaClient;
  await assert.rejects(runLogoImport(db, 'invalid' as 'preview', nonce), /Invalid logo operation mode/);
  await assert.rejects(runLogoImport(db, 'apply', nonce), /Invalid logo operation mode or count/);
  assert.throws(() => audit('verify', nonce, 'ok', 0), /Invalid logo audit/);
  assert.throws(() => audit('apply', nonce, 'ok', 1), /Invalid logo audit/);
  assert.deepEqual(JSON.parse(audit('apply', nonce, 'ok', 0)), {
    operation: 'reviewed-logo-import', mode: 'apply', nonce, status: 'ok', inventoryDigest: REVIEWED_DIGEST,
    sourceFiles: 47, preExisting: 0, inserted: 47, postVerified: 47,
  });
});

test('complete wrapper audit validator rejects malformed, binary, multiline, stale nonce and inconsistent counts without leaking', () => {
  const script = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  // Execute the actual bounded byte parser and output allowlist, without root/systemd.
  const validator = script.slice(script.indexOf('size="$(stat -c %s'));
  const base = 'LOGO_IMPORT_AUDIT ' + audit('apply', nonce, 'ok', 0) + '\n';
  const directory = mkdtempSync('/tmp/logo-wrapper-');
  const auditFile = directory + '/audit';
  try {
    for (const [record, valid, result, expectedExisting = 0] of [
      [base, true, 0], ['LOGO_IMPORT_AUDIT ' + audit('apply', nonce, 'ok', 47) + '\n', true, 0, 47], [base, false, 6], [base + '\n', false, 0], [base + base, false, 0],
      [base.replace(nonce, 'a'.repeat(64)), false, 0], [base.replace('"inserted":47', '"inserted":0'), false, 0],
      [base.replace('"postVerified":47', '"postVerified":46'), false, 0], [base.replace('"sourceFiles":47', '"sourceFiles":48'), false, 0],
      [base.replace('"status":"ok"', '"status":"secret URL password"'), false, 0], [base + '\x00', false, 0],
      [base.slice(0, -1), false, 0], ['secret URL password\n', false, 6], ['x'.repeat(513), false, 0],
      ['LOGO_IMPORT_AUDIT ' + audit('apply', nonce, 'post-commit-verify-failed') + '\n', false, 6],
    ] as const) {
      writeFileSync(auditFile, record);
      const child = spawnSync('bash', ['-c', 'set -euo pipefail; mode=apply; nonce="$NONCE"; audit_file="$AUDIT_FILE"; result="$RESULT"; set -- x x x "$EXPECTED_EXISTING"; ' + validator], {
        encoding: 'utf8', env: { ...process.env, NONCE: nonce, AUDIT_FILE: auditFile, RESULT: String(result), EXPECTED_EXISTING: String(expectedExisting) },
      });
      assert.equal(child.status === 0, valid, child.stdout + child.stderr);
      assert.doesNotMatch(child.stdout + child.stderr, /secret|password|URL/);
      if (valid) assert.match(child.stdout, /"postVerified":47/);
      else assert.equal(child.stdout, '');
    }
  } finally { rmSync(directory, { recursive: true }); }
});

test('post-commit read-back failure has distinct failure status and never success', async () => {
  const { auditReviewedLogos } = await import('../lib/catalog/logo-import.ts');
  const source = await auditReviewedLogos();
  const festivalRows = festivals.map(({ slug }, index) => ({ id: String(index), slug }));
  const blobs = new Map<string, { mimeType: string; sizeBytes: number; bytes: Buffer }>();
  const bindings: { festivalId: string; assetHash: string; festival: { slug: string }; asset: object }[] = [];
  let committed = false;
  const tx = {
    $executeRawUnsafe: async (sql: string, hash: string, mimeType: string, sizeBytes: number, bytes: Buffer) => {
      if (sql.startsWith('INSERT')) blobs.set(hash, { mimeType, sizeBytes, bytes });
      return 1;
    },
    festival: { findMany: async () => festivalRows },
    assetBlob: { findUniqueOrThrow: async ({ where }: { where: { sha256: string } }) => blobs.get(where.sha256) },
    festivalLogo: {
      findMany: async () => bindings,
      create: async ({ data }: { data: { festivalId: string; assetHash: string } }) => {
        bindings.push({ ...data, festival: { slug: festivalRows.find(f => f.id === data.festivalId)!.slug }, asset: blobs.get(data.assetHash)! });
      },
    },
  };
  const db = {
    festival: tx.festival,
    festivalLogo: { findMany: async () => { if (committed) throw new Error('raw secret database URL'); return bindings; } },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      if (committed) throw new Error('raw secret database URL');
      const value = await callback(tx); committed = true; return value;
    },
  } as unknown as PrismaClient;
  const result = await runLogoImport(db, 'apply', nonce, 0);
  assert.equal(committed, true);
  assert.equal(bindings.length, source.length);
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(result.output).status, 'post-commit-verify-failed');
  assert.doesNotMatch(result.output, /raw|secret|URL/);
});

test('dispatcher refuses invalid mode and malformed apply confirmation before touching deployment paths', () => {
  const script = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  const guard = script.slice(0, script.indexOf('root=/opt/festival-radar'));
  for (const args of [['a'.repeat(40), 'invalid'], ['a'.repeat(40), 'apply'],
    ['a'.repeat(40), 'apply', 'wrong', '0', 'b'.repeat(64)],
    ['a'.repeat(40), 'apply', 'APPLY-47-' + 'a'.repeat(40), '1', 'b'.repeat(64)]]) {
    const result = spawnSync('bash', ['-c', 'id() { echo 0; }; ' + guard, 'wrapper-test', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});

test('dispatch asset upgrades use the same host lock as apply and activation', () => {
  for (const filename of ['start-logo-import', 'activate-release', 'upgrade-deployment-assets']) {
    const script = readFileSync('scripts/deploy/' + filename, 'utf8');
    assert.match(script, /exec 9>\/run\/festival-radar-activation\.lock/);
    assert.match(script, /flock -n 9/);
  }
});

test('apply cannot start worker without a root proof checked inside the deployment lock', () => {
  const wrapper = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  const activation = readFileSync('scripts/deploy/activate-release', 'utf8');
  const worker = readFileSync('scripts/deploy/run-reviewed-logo-import.ts', 'utf8');
  const lock = wrapper.indexOf('flock -n 9');
  const check = wrapper.indexOf('"$proof_verifier" check "$commit" "$5"');
  const start = wrapper.indexOf('systemctl start');
  assert.ok(lock >= 0 && check > lock && start > check);
  assert.match(wrapper, /stat -c %u:%g:%a.*proof_verifier.*0:0:644/);
  assert.match(wrapper, /\/usr\/bin\/python3 -I.*proof_verifier.*check/);
  assert.match(wrapper, /echo 'logo root restore proof rejected'.*exit 6/);
  assert.match(activation, /logo-proof/);
  assert.match(worker, /LOGO_IMPORT_PROOF_DIGEST/);
  assert.doesNotMatch(worker, /LOGO_IMPORT_EVIDENCE/);
});

test('root proof failure exits before systemctl, with no raw error output', () => {
  const wrapper = readFileSync('scripts/deploy/start-logo-import', 'utf8');
  const start = wrapper.indexOf('# Repeat the root-file');
  const end = wrapper.indexOf('[[ -f "$audit_file"', start);
  const operation = wrapper.slice(start, end);
  const child = spawnSync('bash', ['-c', 'set -euo pipefail; mode=apply; commit=' + 'a'.repeat(40) +
    '; proof_verifier=/tmp/absent-logo-verifier; set -- x x x x ' + 'b'.repeat(64) +
    '; systemctl() { echo WORKER_STARTED; }; ' + operation], { encoding: 'utf8' });
  assert.equal(child.status, 6);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, 'logo root restore proof rejected\n');
});

test('root verifier packaging and asset upgrades never invoke proof or apply during deployment', () => {
  const packager = readFileSync('scripts/deploy/package-release.sh', 'utf8');
  const updater = readFileSync('scripts/deploy/upgrade-deployment-assets', 'utf8');
  const installer = readFileSync('scripts/deploy/install-release.sh', 'utf8');
  assert.match(packager, /cp scripts\/deploy\/verify-logo-restore-proof\.py/);
  assert.match(packager, /grep -Fxq 'app\/scripts\/deploy\/verify-logo-restore-proof\.py'/);
  assert.match(updater, /for asset in .*verify-logo-restore-proof\.py/);
  assert.match(updater, /asset_mode=0644/);
  assert.match(updater, /ast\.parse/);
  assert.doesNotMatch(updater, /proof_verifier.*issue|logo-apply|logo-proof/);
  assert.doesNotMatch(installer, /logo-proof|logo-apply|enable.*logo-import|logo-import.*timer/);
});
