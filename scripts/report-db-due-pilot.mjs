import { readFile, stat } from 'node:fs/promises';

// Private ingestion artifacts are never printed; emit only bounded counts.
try {
  if (process.argv.length !== 3) throw new Error('arguments');
  const file = process.argv[2];
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > 1_000_000) throw new Error('size');
  const summary = JSON.parse(await readFile(file, 'utf8'));
  const count = (key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0 && summary[key] <= 1;
  if (summary.status !== 'COMPLETED' || summary.dryRun !== false || summary.totalSources !== 1 ||
      summary.attempted !== 1 || !['processed', 'published', 'reviewRequired', 'fetchErrors'].every(count) ||
      summary.fetchErrors !== 0 || summary.published > summary.processed || summary.reviewRequired > summary.processed ||
      summary.published + summary.reviewRequired > summary.processed) throw new Error('summary');
  console.log(JSON.stringify({ attempted: 1, processed: summary.processed, published: summary.published,
    reviewRequired: summary.reviewRequired, fetchErrors: 0 }));
} catch {
  console.error('DB due pilot summary invalid');
  process.exitCode = 1;
}
