import assert from "node:assert/strict";
import test from "node:test";
import { languageDestination } from "../components/LanguageProvider.tsx";

test("language changes stay inside every admin route", () => {
  for (const path of ["/admin", "/admin/", "/admin/review", "/admin/assets/"]) {
    assert.equal(languageDestination(path, "ru"), null);
  }
});

test("language changes keep the existing public navigation behavior", () => {
  assert.equal(languageDestination("/", "de"), "/de/");
  assert.equal(languageDestination("/planner/", "ru"), "/ru/");
});
