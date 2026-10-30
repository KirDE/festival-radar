import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalDetail } from "../components/FestivalDetail";
import { LanguageProvider, translate, type Language } from "../components/LanguageProvider";
import { LocalPlannerProvider } from "../components/LocalPlanner";
import { festival } from "./support/catalog";
import { hasAvailableTickets } from "../lib/tickets";
import { festivalSetlistHistoryUrl } from "../lib/setlist-history";

const similar = { ...festival, slug: "similar-fest", name: "Similar Fest" };

for (const language of ["en", "de", "ru"] as const) {
  test(`live history links to all festival editions, not a future-year search, in ${language}`, () => {
    for (const year of [2026, 2027, 2028]) {
      const item = { ...festival, slug: "wacken-open-air", name: "Wacken Open Air", editionYear: year, startDate: `${year}-07-28` };
      const before = structuredClone(item);
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}><LocalPlannerProvider>
          <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
        </LocalPlannerProvider></LanguageProvider>,
      );
      assert.match(html, /<a href="https:\/\/www\.setlist\.fm\/festivals\/wacken-open-air-bd6bd66\.html" target="_blank" rel="noreferrer">/);
      assert.ok(html.includes(translate(language, "liveHistory")));
      assert.doesNotMatch(html, /setlist\.fm\/search|date%3A|festival%3A/);
      assert.deepEqual(item, before);
    }
  });

  test(`a new festival without a verified history page has no invented setlist.fm URL in ${language}`, () => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}><LocalPlannerProvider>
        <FestivalDetail item={festival} festivals={[festival]} artistSlugs={{}} />
      </LocalPlannerProvider></LanguageProvider>,
    );
    assert.ok(html.includes(`<small>${translate(language, "liveHistory")}</small><strong>${translate(language, "unavailable")}</strong>`));
    assert.doesNotMatch(html, /href="https:\/\/www\.setlist\.fm\//);
  });
}

test("history resolves canonical series independently of display-name aliases", () => {
  assert.equal(festivalSetlistHistoryUrl("hellfest"), "https://www.setlist.fm/festivals/hellfest-1bd6bd44.html");
  assert.equal(festivalSetlistHistoryUrl("impericon"), "https://www.setlist.fm/festivals/impericon-festival-leipzig-63d6eabf.html");
  assert.equal(festivalSetlistHistoryUrl("2000trees"), "https://www.setlist.fm/festivals/2000-trees-festival-63d6b6a3.html");
  for (const slug of ["unknown-festival", "constructor", "toString", "__proto__", "https://example.test/"]) {
    assert.equal(festivalSetlistHistoryUrl(slug), undefined);
  }
});

for (const language of ["en", "de", "ru"] as const) {
  for (const ticketStatus of ["available", "unavailable", "unknown"] as const) {
    test(`ticket page stays linked without changing ${ticketStatus} availability in ${language}`, () => {
      const item = { ...festival, ticketStatus, ticketsUrl: "https://festival.example.test/tickets/" };
      const before = structuredClone(item);
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}><LocalPlannerProvider>
          <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
        </LocalPlannerProvider></LanguageProvider>,
      );
      assert.match(html, new RegExp(`<a href="https://festival.example.test/tickets/"[^>]*data-ticket-status="${ticketStatus}"`));
      assert.ok(html.includes(translate(language, ticketStatus === "available" ? "officialTickets" : "ticketsInfo").replaceAll("&", "&amp;")));
      if (ticketStatus !== "available") {
        assert.ok(html.includes(translate(language, ticketStatus === "unavailable" ? "ticketsUnavailable" : "ticketsUnknown")));
        assert.ok(!html.includes(translate(language, "officialTickets")));
      }
      assert.equal(hasAvailableTickets(item), ticketStatus === "available");
      assert.deepEqual(item, before);
    });
  }
}

test("missing ticket URL stays disabled for every availability state", () => {
  for (const ticketStatus of ["available", "unavailable", "unknown"] as const) {
    const item = { ...festival, ticketStatus, ticketsUrl: undefined };
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage="en"><LocalPlannerProvider>
        <FestivalDetail item={item} festivals={[item]} artistSlugs={{}} />
      </LocalPlannerProvider></LanguageProvider>,
    );
    assert.match(html, /class="disabled" data-ticket-status="(?:unknown|unavailable)"/);
    assert.equal(hasAvailableTickets(item), false);
    assert.doesNotMatch(html, /href="(?:undefined|#)"/);
  }
});
const expectations: Record<"de" | "ru", string[]> = {
  de: ["☆ Speichern", "Teilnahme wählen", "Dabei", "Vielleicht", "Nicht dabei", "Meinen Plan öffnen →", "REISE PLANEN", "Kalender &amp; Karte", "Bühnenplan", "Noch kein bestätigter Zeitplan", "Ähnliche Festivals", "1 gemeinsame Künstler"],
  ru: ["☆ Сохранить", "Укажите участие", "Пойду", "Возможно", "Не пойду", "Открыть мой план →", "ПЛАНИРОВАНИЕ ПОЕЗДКИ", "Календарь и карта", "Расписание сцен", "Подтверждённое расписание пока не опубликовано", "Похожие фестивали", "Общих артистов: 1"],
};

for (const language of ["de", "ru"] as const) {
  test("detail renders all primary actions and trip copy in " + language, () => {
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <LocalPlannerProvider>
          <FestivalDetail item={festival} festivals={[festival, similar]} artistSlugs={{ "Sample Artist": "sample-artist" }} />
        </LocalPlannerProvider>
      </LanguageProvider>,
    );
    for (const copy of expectations[language]) assert.ok(html.includes(copy), "Missing " + copy);
    for (const english of ["☆ Save", "Set attendance", "Going", "Maybe", "Not going", "Open my plan", "PLAN THE TRIP", "Calendar &amp; map", "Stage timetable", "No verified timetable", "Similar festivals", "shared act"]) {
      assert.ok(!html.includes(english), "Unexpected English copy: " + english);
    }
    assert.equal(translate(language as Language, "saved"), language === "de" ? "★ Gespeichert" : "★ Сохранено");
    assert.ok(html.includes('href="/planner"') || html.includes('href="/planner/"'));
  });
}

const updateDates = {
  en: "Catalogue data updated on October 10, 2026.",
  de: "Katalogdaten aktualisiert am 10. Oktober 2026.",
  ru: "Данные каталога обновлены: 10 октября 2026 г.",
};

for (const language of ["en", "de", "ru"] as const) {
  test("transparency renders this festival's catalogue update in " + language, () => {
    for (const sourceDeprecated of [false, true]) {
      const item = { ...festival, updatedAt: "2026-10-10T23:24:25.585Z", sourceDeprecated };
      const before = structuredClone(item);
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <FestivalDetail item={item} festivals={[item]} artistSlugs={{ "Sample Artist": "sample-artist" }} />
          </LocalPlannerProvider>
        </LanguageProvider>,
      );
      assert.ok(html.includes(updateDates[language]));
      assert.doesNotMatch(html, /28 August 2026|28\. August 2026|28 августа 2026|Seed data/);
      if (sourceDeprecated) assert.ok(html.includes(translate(language, "sourceDeprecatedHelp")));
      else assert.ok(html.includes(translate(language, "sourceText")));
      assert.deepEqual(item, before);
    }
  });
}

test("transparency follows an older catalogue record without claiming a fresh review", () => {
  const item = { ...festival, updatedAt: "2026-09-03T00:00:00Z" };
  const html = renderToStaticMarkup(
    <LanguageProvider initialLanguage="en"><LocalPlannerProvider>
      <FestivalDetail item={item} festivals={[item]} artistSlugs={{ "Sample Artist": "sample-artist" }} />
    </LocalPlannerProvider></LanguageProvider>,
  );
  assert.ok(html.includes("Catalogue data updated on September 3, 2026."));
  assert.doesNotMatch(html, /October 10|Seed data|data reviewed/);
});

for (const language of ["en", "de", "ru"] as const) {
  test("playlist links show their own provider counts in " + language, () => {
    for (const hasYoutubeCounts of [true, false]) {
      const playlist = {
        spotifyUrl: "https://open.spotify.com/playlist/spotify",
        youtubeMusicUrl: "https://music.youtube.com/playlist?list=youtube",
        artists: 44, tracks: 208, updatedAt: "2026-10-18",
        ...(hasYoutubeCounts ? { youtubeMusicArtists: 43, youtubeMusicTracks: 205 } : {}),
      };
      const html = renderToStaticMarkup(
        <LanguageProvider initialLanguage={language}><LocalPlannerProvider>
          <FestivalDetail item={festival} festivals={[festival]} artistSlugs={{}} playlist={playlist} />
        </LocalPlannerProvider></LanguageProvider>,
      );
      const spotify = html.match(/<a href="https:\/\/open\.spotify\.com\/playlist\/spotify"[^>]*>(.*?)<\/a>/)?.[1];
      const youtube = html.match(/<a href="https:\/\/music\.youtube\.com\/playlist\?list=youtube"[^>]*>(.*?)<\/a>/)?.[1];
      assert.ok(spotify?.includes(`44 ${translate(language, "artists")} · 208 ${translate(language, "tracks")}`));
      assert.ok(youtube);
      assert.ok(!youtube.includes("208"), "YouTube must never borrow Spotify's track count");
      if (hasYoutubeCounts) assert.ok(youtube.includes(`43 ${translate(language, "artists")} · 205 ${translate(language, "tracks")}`));
      else assert.ok(!youtube.includes(translate(language, "tracks")), "Missing YouTube counts stay unknown");
    }
  });
}
