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
