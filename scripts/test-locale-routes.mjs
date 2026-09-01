import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 3421;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
let output = "";
server.stdout.on("data", (chunk) => { output += chunk; });
server.stderr.on("data", (chunk) => { output += chunk; });

async function ready() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${origin}/en/`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not start:\n${output}`);
}

const expected = { en: "Find your next", de: "Finde dein nächstes", ru: "Найди свои следующие" };
try {
  await ready();
  for (const [lang, visible] of Object.entries(expected)) {
    const response = await fetch(`${origin}/${lang}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(`<html lang="${lang}"`));
    assert.ok(html.includes(visible), `${lang} visible copy is missing`);
    assert.ok(html.includes(`rel="canonical" href="https://festivals.kir-it.de/${lang}/"`));
    for (const alternate of ["en", "de", "ru"]) assert.ok(html.includes(`hrefLang="${alternate}" href="https://festivals.kir-it.de/${alternate}/"`));
    assert.ok(html.includes(`href="/${lang}/"`), `${lang} navigation does not preserve locale`);
    assert.ok(html.includes(`href="/${lang}/planner/"`), `${lang} planner link does not preserve locale`);
    assert.ok(html.includes(`href="/${lang}/submit/"`), `${lang} submission link does not preserve locale`);

    const submission = await fetch(`${origin}/${lang}/submit/`);
    assert.equal(submission.status, 200);
    assert.match(await submission.text(), new RegExp(`<html lang="${lang}"`));

    const planner = await fetch(`${origin}/${lang}/planner/`);
    assert.equal(planner.status, 200);
    assert.match(await planner.text(), new RegExp(`<html lang="${lang}"`));

    const enrichedArtist = await fetch(`${origin}/${lang}/artists/electric-callboy/`);
    assert.equal(enrichedArtist.status, 200);
    const enrichedHtml = await enrichedArtist.text();
    assert.match(enrichedHtml, new RegExp(`<html lang="${lang}"`));
    assert.ok(enrichedHtml.includes({ en: "Recent setlists", de: "Aktuelle Setlists", ru: "Недавние сетлисты" }[lang]));
    assert.ok(enrichedHtml.includes(`href="/${lang}/"`));

    const partialArtist = await fetch(`${origin}/${lang}/artists/abbie-falls/`);
    assert.equal(partialArtist.status, 200);
    assert.match(await partialArtist.text(), new RegExp(`<html lang="${lang}"`));

    const festival = await fetch(`${origin}/${lang}/festivals/wacken-open-air/`);
    assert.equal(festival.status, 200);
    const festivalHtml = await festival.text();
    assert.match(festivalHtml, new RegExp(`<html lang="${lang}"`));
    assert.ok(festivalHtml.includes(`href="/${lang}/artists/electric-callboy/"`));

    const manifest = await fetch(`${origin}/${lang}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const pwa = await manifest.json();
    assert.equal(pwa.lang, lang);
    assert.equal(pwa.start_url, `/${lang}/`);
  }
  console.log("Locale route browser smoke passed for en, de and ru.");
} finally {
  server.kill("SIGTERM");
}
