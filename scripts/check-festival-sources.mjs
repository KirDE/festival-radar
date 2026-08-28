import { festivals } from "../data/festivals.ts";

const failures = [];
for (let index = 0; index < festivals.length; index += 5) {
  const batch = festivals.slice(index, index + 5);
  await Promise.all(batch.map(async (festival) => {
    try {
      const response = await fetch(festival.officialUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
        headers: { "User-Agent": "FestivalRadar/1.0 (+https://festivals.kir-it.de)" },
      });
      if (response.status === 404 || response.status === 410 || response.status >= 500) failures.push(`${festival.name}: HTTP ${response.status}`);
      else if (response.status === 401 || response.status === 403 || response.status === 429) process.stdout.write(`REACHABLE ${response.status} ${festival.name} (automated access restricted)\n`);
      else process.stdout.write(`OK ${response.status} ${festival.name}\n`);
    } catch (error) {
      failures.push(`${festival.name}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }));
}

if (process.env.SETLIST_API_KEY) {
  const response = await fetch("https://api.setlist.fm/rest/1.0/search/artists?artistName=Metallica&p=1&sort=relevance", {
    headers: { Accept: "application/json", "x-api-key": process.env.SETLIST_API_KEY },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) failures.push(`setlist.fm API: HTTP ${response.status}`);
  else process.stdout.write("OK setlist.fm API\n");
} else {
  process.stdout.write("SKIP setlist.fm API (SETLIST_API_KEY not configured)\n");
}

if (failures.length) {
  process.stderr.write(`Source checks requiring review:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
}
