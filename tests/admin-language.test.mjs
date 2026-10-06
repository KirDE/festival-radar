import assert from "node:assert/strict";
import test from "node:test";
import { languageDestination } from "../components/LanguageProvider.tsx";

test("language changes stay inside every admin route", () => {
  for (const path of ["/admin", "/admin/", "/admin/review", "/admin/assets/"]) {
    assert.equal(languageDestination(path, "ru"), null);
  }
});

test("language changes never navigate public routes or lose query/hash", () => {
  for (const path of ["/", "/planner/", "/en/planner/?filter=artist#calendar", "/notifications/?tab=channels", "/de/notifications/", "/ru/artists/example/", "/festivals/example/2027/", "/share/token/"]) {
    for (const locale of ["en", "de", "ru"]) assert.equal(languageDestination(path, locale), null);
  }
});
