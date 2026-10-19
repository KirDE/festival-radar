import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { executePlaylistJson } from '../lib/catalog/python-playlist-rpc.ts';

function run(program, value, overrides = {}) {
  return executePlaylistJson(process.execPath, ['-e', program], value, {
    cwd: process.cwd(), env: process.env, signal: new AbortController().signal, timeout: 5_000, ...overrides,
  });
}

test('playlist IPC roundtrips a large Unicode plan, with diagnostics separate from JSON', async () => {
  const value = { title: 'Фестиваль 演奏 🎸', plan: 'x'.repeat(1_100_000) };
  assert.deepEqual(await run(`let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{console.error('diagnostic');console.log(JSON.stringify(JSON.parse(s)))});`, value), value);
});

test('provider quota and reconciliation exits keep retry codes and never return partial success', async () => {
  for (const code of [2, 3]) {
    await assert.rejects(run(`process.stdin.resume();process.stdin.on('end',()=>{console.log('{}');console.error('provider_checkpoint');process.exit(${code})});`, {}), error => error.code === code && error.stderr === 'provider_checkpoint\n');
  }
  await assert.rejects(run(`process.stdin.resume();process.stdin.on('end',()=>console.log('not json'));`, {}), /Invalid playlist provider reply/);
});

test('IPC bounds input/output and respects cancellation/timeout', async () => {
  await assert.rejects(run('throw new Error("must not start")', 'x'.repeat(8 * 1024 * 1024)), /request too large/);
  await assert.rejects(run(`process.stdout.write('x'.repeat(8 * 1024 * 1024 + 1));`, {}), error => error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  await assert.rejects(run('setInterval(()=>{},1000)', {}, { timeout: 30 }), error => error.killed === true);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run('setInterval(()=>{},1000)', {}, { signal: controller.signal }), error => error.name === 'AbortError');
});

test('database playlist worker has no file-backed plan/report exchange', async () => {
  const worker = await readFile('scripts/playlist-worker.ts', 'utf8');
  assert.doesNotMatch(worker, /node:fs|mkdtemp|writeFile|readFile|reportPath|planPath|WORK_DIRECTORY/);
  for (const operation of ['discover-spotify', 'apply-spotify', 'discover-youtube', 'apply-youtube']) assert.ok(worker.includes(operation));
  assert.match(worker, /stagePlaylistPlan/); assert.match(worker, /stageYoutubePlan/);
  assert.match(worker, /publishSpotifyCheckpoint/); assert.match(worker, /PLAYLIST_LEASE/);
});
