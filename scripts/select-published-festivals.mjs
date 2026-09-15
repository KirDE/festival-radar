import { readFile } from "node:fs/promises";

const responsePath = process.argv[2];
if (!responsePath) throw new Error("usage: select-published-festivals.mjs RESPONSE_JSON");

const response = JSON.parse(await readFile(responsePath, "utf8"));
const slugs = [...new Set(
  (response.summary?.results ?? [])
    .filter((result) => result?.outcome === "published")
    .map((result) => result.festivalSlug)
    .filter((slug) => typeof slug === "string" && slug.length > 0),
)].sort();

if (slugs.length !== Number(response.summary?.published ?? 0)) {
  throw new Error(`published count mismatch: summary=${response.summary?.published ?? 0}, slugs=${slugs.length}`);
}
process.stdout.write(slugs.join(","));
