import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

test('GitHub Actions is limited to build validation and deployment; production owns runtime work', async () => {
  const files = (await readdir('.github/workflows')).filter(file => /\.ya?ml$/.test(file)).sort();
  assert.deepEqual(files, ['deploy.yml', 'quality.yml']);
  for (const file of files) {
    const workflow = await readFile(`.github/workflows/${file}`, 'utf8');
    assert.doesNotMatch(workflow, /^\s*(schedule|repository_dispatch|workflow_run):/m);
    assert.doesNotMatch(workflow, /\/api\/(?:ingestion|playlists|source-monitor|notifications|analytics\/prune)\/|npm run (?:ingest|check:sources|resolve:artists|analytics:prune)\b/);
  }
});
