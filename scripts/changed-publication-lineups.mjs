import { readFile } from "node:fs/promises";

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) throw new Error("usage: changed-publication-lineups.mjs BEFORE_JSON AFTER_JSON");

const before = JSON.parse(await readFile(beforePath, "utf8")).festivals ?? {};
const after = JSON.parse(await readFile(afterPath, "utf8")).festivals ?? {};
const comparable = (festival) => JSON.stringify({
  headliners: festival?.headliners ?? [],
  lineup: festival?.lineup ?? [],
});
const slugs = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  .filter((slug) => comparable(before[slug]) !== comparable(after[slug]))
  .sort();
process.stdout.write(slugs.join(","));
