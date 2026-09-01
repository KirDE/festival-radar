import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const provider = await readFile(new URL("../components/LanguageProvider.tsx", import.meta.url), "utf8");
const artistDetail = await readFile(new URL("../components/ArtistDetail.tsx", import.meta.url), "utf8");
const providerRoute = await readFile(new URL("../app/[lang]/artists/[slug]/page.tsx", import.meta.url), "utf8");

const expected = {
  en: ["Also known as", "Profile", "Origin", "Genres", "Top tracks", "Sources and canonical identities", "checked", "Recent setlists", "View setlist", "Profile refreshed every"],
  de: ["Auch bekannt als", "Profil", "Herkunft", "Genres", "Top-Titel", "Quellen und kanonische Identitäten", "geprüft", "Aktuelle Setlists", "Setlist ansehen", "Profil aktualisiert alle"],
  ru: ["Также известен как", "Профиль", "Страна происхождения", "Жанры", "Популярные треки", "Источники и канонические идентификаторы", "проверено", "Недавние сетлисты", "Открыть сетлист", "Профиль обновляется каждые"],
};

test("artist enrichment labels are complete when switching every supported language", () => {
  for (const [language, labels] of Object.entries(expected)) {
    const languageBlock = provider.match(new RegExp(`\\n  ${language}: \\{([\\s\\S]*?)\\n  \\},`));
    assert.ok(languageBlock, `${language} translation catalog is present`);
    for (const label of labels) assert.match(languageBlock[1], new RegExp(label), `${language} includes ${label}`);
  }
});

test("artist routes and links preserve every supported locale", () => {
  assert.match(provider, /languageDestination\(window\.location\.pathname, selected\)/);
  assert.match(provider, /languagePath\(pathname, selected\)/);
  assert.match(providerRoute, /supportedLanguages\.flatMap/);
  assert.match(providerRoute, /canonical: `\/\$\{lang\}\/artists\/\$\{artist\.slug\}\//);
  assert.match(artistDetail, /href=\{`\/\$\{language\}\//);
});

test("artist enrichment UI renders all labels through LanguageProvider", () => {
  for (const key of ["alsoKnownAs", "profile", "origin", "genres", "topTracks", "sourcesAndIdentities", "checked", "recentSetlists", "viewSetlist", "freshnessProfile", "freshnessMusic", "freshnessSetlists", "freshnessDays"]) {
    assert.match(artistDetail, new RegExp(`t\\(\\"${key}\\"\\)`));
  }
  for (const englishOnly of expected.en) assert.ok(!artistDetail.includes(`>${englishOnly}<`), `${englishOnly} is not hard-coded as visible text`);
});
