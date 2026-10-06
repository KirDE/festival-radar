#!/usr/bin/env node
import { runCli } from '../lib/ingestion/review-queue.mjs';

process.exitCode = await runCli(process.argv.slice(2), process.env, {
  connect: async (url) => {
    const { PrismaClient } = await import('@prisma/client');
    return new PrismaClient({ datasources: { db: { url } }, log: [] });
  },
  output: (json) => process.stdout.write(json),
});
