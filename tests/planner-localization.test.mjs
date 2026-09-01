import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const planner = readFileSync(new URL("../components/PlannerPage.tsx", import.meta.url), "utf8");
const views = readFileSync(new URL("../components/FestivalViews.tsx", import.meta.url), "utf8");
const chrome = readFileSync(new URL("../components/SiteChrome.tsx", import.meta.url), "utf8");
const language = readFileSync(new URL("../components/LanguageProvider.tsx", import.meta.url), "utf8");

test("planner exposes localized EN, DE and RU visible headings and every core control", () => {
  for (const text of ["Your 2027 plan", "Dein Plan für 2027", "Ваш план на 2027 год", "Kalender herunterladen (.ics)", "Скачать календарь (.ics)", "Teilnahme an", "Посещение", "Private Spotify-Playlist erstellen", "Создать приватный плейлист Spotify", "Künstlerliste herunterladen", "Скачать список артистов"]) {
    assert.match(planner, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(planner, /const \{ language \} = useLanguage\(\)/);
  assert.match(planner, /<h1>\{t\.title\}<\/h1>/);
});

test("planner calendar and map expose localized visible and accessible copy", () => {
  for (const text of ["Festival calendar", "Festivalkalender", "Календарь фестивалей", "Previous month", "Vorheriger Monat", "Предыдущий месяц", "Festival map", "Festivalkarte", "Карта фестивалей"]) {
    assert.match(views, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(views, /aria-label=\{t\.previous\}/);
  assert.match(views, /aria-label=\{t\.mapLabel\}/);
});

test("primary navigation uses the translated notification label", () => {
  assert.match(chrome, /t\("notifications"\)/);
  for (const text of ["Notifications", "Benachrichtigungen", "Уведомления"]) assert.match(language, new RegExp(text));
});
