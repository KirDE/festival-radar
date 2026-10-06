import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dueWorkerHealth } from '../lib/ingestion/due-health.ts';

const now = new Date('2026-10-01T09:00:00.000Z');
test('health emits numeric aggregates only and partitions due, live, expired and lagged rows', async () => {
  const queries = [];
  const db = {
    festivalSource: {
      count: async (query) => { queries.push(query); return queries.length; },
      groupBy: async () => [
        { festivalSlug: 'fixture', strategies: ['manual_review'], parserKey: 'manual_review', _count: { _all: 4 } },
        { festivalSlug: 'fixture', strategies: ['manual_review'], parserKey: 'untrusted:private-festival', _count: { _all: 3 } },
        { festivalSlug: 'fixture', strategies: ['manual_review'], parserKey: null, _count: { _all: 1 } },
        { festivalSlug: 'fixture', strategies: ['json_ld_event'], parserKey: 'manual_review', _count: { _all: 2 } },
        { festivalSlug: 'fixture', strategies: ['official_markup'], parserKey: 'official_markup:wacken', _count: { _all: 1 } },
      ],
    },
    ingestionNotificationOutbox: { count: async (query) => { queries.push(query); return queries.length; } },
  };
  const result = await dueWorkerHealth(db, now);
  assert.deepEqual(result, { due: 1, queueLaggedOverHour: 2, active: 3, expired: 4, error: 5, outboxPending: 6, outboxLaggedOverHour: 7, unknownParserKeys: 7 });
  assert.equal(queries[0].where.OR[1].nextRunAt.lte, now);
  assert.equal(queries[2].where.leaseExpiresAt.gt, now);
  assert.equal(queries[3].where.leaseExpiresAt.lte, now);
  assert.equal(queries[6].where.createdAt.lte.toISOString(), '2026-10-01T08:00:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /private-festival|untrusted/);
});

test('manual unit is fixed-mode and due timer rearms only after exact-release checks', async () => {
  const [installer, starter, runner, packageScript] = await Promise.all([
    'scripts/deploy/install-release.sh', 'scripts/deploy/start-db-due',
    'scripts/deploy/run-db-due-operation.sh', 'scripts/deploy/package-release.sh',
  ].map((file) => readFile(file, 'utf8')));
  assert.ok(installer.includes('$service-db-due@.service'));
  assert.match(installer, /db_due_restore_assets.*systemctl daemon-reload/s);
  assert.ok(installer.includes("trap cleanup_install EXIT"));
  assert.ok(installer.includes("db_due_assets_armed=true"));
  const cleanup = installer.slice(installer.indexOf('cleanup_install()'), installer.indexOf('trap cleanup_install EXIT'));
  assert.match(cleanup, /if \[\[ "\$status" -ne 0 \]\]; then/);
  assert.match(cleanup, /if \[\[ "\$db_due_assets_armed" == true \]\]; then\s+db_due_restore_assets "\$db_due_unit" "\$db_due_wrapper" "\$db_due_backup"/);
  assert.match(cleanup, /if \[\[ "\$db_due_assets_armed" == true \|\| "\$scheduler_assets_armed" == true \]\]; then\s+systemctl daemon-reload/);
  assert.ok(installer.includes('ExecStart=$release/scripts/deploy/run-db-due-operation.sh %i $commit'));
  assert.match(installer, /if \[\[ "\$db_due_timer_was_armed" == true \]\]/);
  assert.match(installer, /systemctl enable --now "\$service-db-due.timer"/);
  assert.ok(installer.includes('User=www-data') && installer.includes('ProtectSystem=strict'));
  assert.match(starter, /flock -n 9/);
  assert.match(starter, /deployed commit mismatch/);
  assert.ok(starter.includes('health|ingest|drain'));
  assert.match(runner, /--db-due --publish --max-fetch-errors=0/);
  assert.ok(runner.includes('--output=$output'));
  assert.match(runner, /trap 'rm -rf/);
  assert.ok(packageScript.includes('scripts/report-db-due-health.mjs'));
  assert.ok(packageScript.includes('scripts/deploy/db-due-assets.sh'));
});

test('failed cleanup restores DB due only when armed; success never restores', async () => {
  const installer = await readFile('scripts/deploy/install-release.sh', 'utf8');
  const cleanup = installer.slice(installer.indexOf('cleanup_install()'), installer.indexOf('trap cleanup_install EXIT'));
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'db-due-rollback-'));
  try {
    for (const [armed, failed, priorActive, expected] of [
      [true, true, true, ['restore', 'daemon-reload']],
      [true, true, false, ['daemon-reload']],
      [false, true, true, []],
      [true, false, true, []],
    ]) {
      const script = 'set -euo pipefail; ' + cleanup + '\n' +
        'db_due_restore_assets() { printf "restore\n"; }; systemctl() { printf "%s\n" "$*"; }; ' +
        'prior_release_is_active() { [[ "$PRIOR_ACTIVE" == true ]]; }; scheduler_assets_armed=false; scheduler_backup=""; ' +
        'db_due_assets_armed="$ARMED"; db_due_unit=unit; db_due_wrapper=wrapper; db_due_backup=""; ' +
        'archive="$TEMP/archive"; env_source="$TEMP/env"; ' +
        (failed ? 'false || cleanup_install' : 'cleanup_install');
      const result = spawnSync('bash', ['-c', script], { encoding: 'utf8',
        env: { ...process.env, TEMP: temporary, ARMED: armed ? 'true' : 'false',
          PRIOR_ACTIVE: priorActive ? 'true' : 'false' } });
      assert.equal(result.status, failed ? 1 : 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split('\n').filter(Boolean), expected);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
