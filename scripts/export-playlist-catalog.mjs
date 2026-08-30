import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { festivals } from "../data/festivals.ts";

const output = process.argv[2] || "tmp/festival-playlist-catalog.json";
const years = [...new Set(festivals.map((festival) => festival.editionYear).filter(Number.isInteger))];
if (years.length !== 1) throw new Error(`canonical catalog contains mixed editions: ${years.join(", ")}`);

const catalog = {
  generatedAt: new Date().toISOString(),
  season: years[0],
  festivals: festivals.map((festival) => ({
    slug: festival.slug,
    name: festival.name,
    editionYear: festival.editionYear,
    status: festival.status,
    artists: [...new Set([...festival.headliners, ...festival.lineup])],
    headliners: [...new Set(festival.headliners)],
    playlistUrl: festival.playlistUrl,
  })),
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Exported ${catalog.festivals.length} festivals for ${catalog.season} to ${output}`);
