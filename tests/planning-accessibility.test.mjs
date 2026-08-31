import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
const explorer = await readFile(new URL("../components/FestivalExplorer.tsx", import.meta.url), "utf8");
const provider = await readFile(new URL("../components/LanguageProvider.tsx", import.meta.url), "utf8");

test("every supported locale contains the same planning catalog", () => {
  const planningKeys = ["filterSearch", "filterMonth", "allMonths", "filterGenre", "allGenres", "filterOrigin", "fromOrigin", "filterDistance", "anyDistance", "withinDistance", "officialTicketsOnly", "compare", "compareFestival", "removeFestivalComparison", "comparisonSelected", "comparisonRemoved", "comparisonLimit", "comparisonInstructions", "planningDetail", "dates", "locationDistance", "distanceUnavailable", "tickets", "unavailable", "availabilityNotConfirmed", "lineupOverlap", "sharedActs", "noLineupOverlap", "noDiscoveryMatches"];
  for (const key of planningKeys) assert.equal((provider.match(new RegExp(`\\b${key}:`, "g")) || []).length, 3, `${key} must exist in en, de and ru`);
  assert.ok(provider.includes("replaceAll(`{${name}}`, String(value))"), "translations must interpolate accessible names and announcements");
});

test("planning filters and comparison controls expose accessible names and state", () => {
  for (const marker of [
    'aria-label={t("filterSearch")}', 'aria-label={t("filterMonth")}', 'aria-label={t("filterGenre")}',
    'aria-label={t("filterOrigin")}', 'aria-label={t("filterDistance")}', 'aria-pressed={isSelected}',
    'aria-label={t("compareFestival", { festival: item.name })}', 'role="status"', 'aria-live="polite"',
    '<th scope="col"', '<th scope="row"', 'className="comparisonScroll" tabIndex={0}',
  ]) assert.ok(explorer.includes(marker), `missing accessible behavior: ${marker}`);
});

test("planning UI has no remaining hard-coded English control or comparison copy", () => {
  for (const text of ["All months", "Official tickets only", "+ Compare", "Planning detail", "distance unavailable", "Availability not confirmed", "No announced lineup overlap yet", "Try a wider distance"]) {
    assert.equal(explorer.includes(text), false, `hard-coded planning copy remains: ${text}`);
  }
});
