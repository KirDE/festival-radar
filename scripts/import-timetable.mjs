import { readFile } from 'node:fs/promises';
import { db } from '../lib/db.ts';
import { importTimetable } from '../lib/catalog/timetable-import.ts';
const inputPath = process.argv.find(value => value.startsWith('--input='))?.slice(8);
if (!inputPath || !process.env.DATABASE_URL) throw new Error('DATABASE_URL and --input=/path/to/reviewed.json required; default is preview, --apply writes');
try {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  console.log(JSON.stringify(await importTimetable(db, input, !process.argv.includes('--apply'))));
} finally { await db.$disconnect(); }
