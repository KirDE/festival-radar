import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("public catalogue routes resolve fresh data at request time", async () => {
  const files = (await readdir("app", { recursive: true }))
    .filter((file) => /(?:page\.tsx|sitemap\.ts)$/.test(file));
  const catalogueRoutes = [];
  for (const file of files) {
    const source = await readFile(path.join("app", file), "utf8");
    if (!source.includes("getCatalog")) continue;
    catalogueRoutes.push(file);
    assert.match(source, /export const dynamic = "force-dynamic"/);
    if (file !== "[lang]/page.tsx") assert.doesNotMatch(source, /generateStaticParams/);
  }
  assert.ok(catalogueRoutes.length >= 16);
});

test("festival details receive related catalogue data from the database snapshot", async () => {
  const source = await readFile("components/FestivalDetail.tsx", "utf8");
  assert.doesNotMatch(source, /import \{[^}]*\b(?:artistSlug|festivals)\b[^}]*\} from "@\/data\/festivals"/);
  assert.match(source, /festivals: Festival\[\]/);
  assert.match(source, /artistSlugs: Readonly<Record<string, string>>/);
});

test("production catalogue code has no file mode or runtime overlay writes", async () => {
  const repository = await readFile("lib/catalog/repository.ts", "utf8");
  const ingestion = await readFile("scripts/ingest-festivals.mjs", "utf8");
  const deploy = await readFile(".github/workflows/deploy.yml", "utf8");
  const ingestionWorkflow = await readFile(".github/workflows/ingestion.yml", "utf8");
  const playlistWorkflow = await readFile(".github/workflows/playlists.yml", "utf8");
  const qualityWorkflow = await readFile(".github/workflows/quality.yml", "utf8");

  assert.doesNotMatch(repository, /FileCatalogRepository|CATALOG_READ_MODE|CATALOG_DATABASE_FALLBACK_ENABLED/);
  assert.match(ingestion, /publish && !persistenceEnabled/);
  assert.match(ingestion, /!persistenceEnabled && history\.length/);
  assert.doesNotMatch(deploy, /ingestion-publications|changed-publication-lineups/);
  assert.match(ingestionWorkflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(ingestionWorkflow, /contents: write|pull-requests: write|create-pull-request/);
  assert.doesNotMatch(playlistWorkflow, /create-pull-request|data\/playlist-status\.json/);
  assert.match(qualityWorkflow, /test:catalog-db[\s\S]*catalog:backfill[\s\S]*test:integration/);
  assert.match(qualityWorkflow, /test:admin:integration[\s\S]*prisma migrate reset --force[\s\S]*catalog:backfill[\s\S]*test:admin:e2e/);
});
