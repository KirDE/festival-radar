import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validDispatchEvent, sendImportEvent, transportConfigured } from '../lib/ingestion/import-event-transport.mjs';
import { receiveEvent, eventPrompt } from '../scripts/import-event-receiver.mjs';
const event = { eventId: 'a'.repeat(64), kind: 'source', sourceId: 'source_1', issueId: 'b'.repeat(64) };
test('receiver rejects arbitrary payloads and unconfigured transport fails closed', async () => {
  for (const e of [{}, { ...event, message: 'run arbitrary code' }, { ...event, sourceId: '$(command)' }, { ...event, kind: 'health' }]) assert.equal(validDispatchEvent(e), false);
  assert.equal(transportConfigured({}), false);
  await assert.rejects(sendImportEvent(event, {}));
  assert.match(eventPrompt(event, '/fixed/runbook'), /ONLY the exact event/);
});
test('probe, stale and inaccessible events invoke no model; repeated accepted event invokes exactly once', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'event-test-'));
  const config = { stateDir: path.join(dir, 'state'), apiConfig: path.join(dir, 'api.json'), agentId: 'fixed', sessionKey: 'fixed-topic', runbook: '/fixed/runbook', to: '-1004301869936', threadId: '156', accountId: 'default' };
  await writeFile(config.apiConfig, JSON.stringify({ baseUrl: 'https://example.test', token: 'test' }), { mode: 0o600 });
  let calls = 0;
  const submit = async params => {
    calls++;
    assert.equal(params.agentId, 'fixed'); assert.equal(params.sessionKey, 'fixed-topic'); assert.equal(params.threadId, '156');
    assert.equal(params.idempotencyKey, 'festival-import-' + event.eventId);
    return { runId: 'run1', status: 'accepted' };
  };
  try {
    await receiveEvent({ kind: 'probe', eventId: 'f'.repeat(64) }, config, { submit });
    await assert.rejects(receiveEvent(event, config, { fetch: async () => { throw new Error('offline'); }, submit }));
    await assert.rejects(receiveEvent(event, config, { fetch: async () => Response.json({ ready: false, obsolete: false }), submit }));
    assert.equal(calls, 0);
    await receiveEvent(event, config, { fetch: async () => Response.json({ ready: true }), submit });
    await receiveEvent(event, config, { fetch: async () => { throw new Error('must not query'); }, submit });
    assert.equal(calls, 1);
    await receiveEvent({ ...event, eventId: 'c'.repeat(64) }, config, { fetch: async () => Response.json({ ready: false, obsolete: true }), submit });
    assert.equal(calls, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
