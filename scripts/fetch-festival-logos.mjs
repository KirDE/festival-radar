import { access, mkdir, writeFile } from "node:fs/promises";

const source = await import("../data/festivals.ts");
const output = new URL("../public/logos/", import.meta.url);
await mkdir(output, { recursive: true });

async function fetchLogo(festival) {
  const target = new URL(`${festival.slug}.png`, output);
  try { await access(target); return; } catch {}
  const domain = new URL(festival.officialUrl).hostname;
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, { signal: AbortSignal.timeout(8000) });
    } catch {}
    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  if (!response?.ok) { process.stderr.write(`Skipped ${festival.slug}: ${response?.status || "timeout"}\n`); return; }
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  process.stdout.write(`Fetched ${festival.slug}\n`);
}

for (let index = 0; index < source.festivals.length; index += 5) {
  await Promise.all(source.festivals.slice(index, index + 5).map(fetchLogo));
  await new Promise((resolve) => setTimeout(resolve, 300));
}
