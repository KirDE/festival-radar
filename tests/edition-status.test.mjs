import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { editionStatusLabel } from "../lib/edition-status.ts";

function makeEdition(overrides = {}) {
  return {
    slug: "synthetic-fest", name: "Synthetic Fest", country: "Germany", countryCode: "DE",
    editionYear: 2027, recordState: "tracking", completeness: "tba",
    status: "tba", ticketStatus: "unknown", headliners: [], lineup: [],
    officialUrl: "https://example.test/", updatedAt: "2026-10-08T00:00:00Z",
    genres: [], provenance: [], ...overrides,
  };
}

// Execute the real route and its JSX with only the catalogue and Next boundary
// stubbed. Unexpected imports fail closed, so this cannot reach a database.
const source = await readFile(new URL("../app/festivals/[slug]/[year]/page.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const require = createRequire(import.meta.url);
function loadPage(editions) {
  const exports = {};
  const dependencies = {
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": ({ children, ...props }) => createElement("a", props, children),
    "next/navigation": { notFound() { throw new Error("NEXT_NOT_FOUND"); } },
    "@/lib/catalog/repository": { getCatalog: async () => ({ editions }) },
    "@/lib/edition-status": { editionStatusLabel },
  };
  new Function("require", "exports", outputText)((id) => {
    assert.ok(Object.hasOwn(dependencies, id), `Unexpected route dependency: ${id}`);
    return dependencies[id];
  }, exports);
  assert.equal(exports.dynamic, "force-dynamic");
  return exports.default;
}

async function renderEdition(item, editions = [item]) {
  const page = loadPage(editions);
  return renderToStaticMarkup(await page({ params: Promise.resolve({ slug: item.slug, year: String(item.editionYear) }) }));
}

test("stale TBA completeness derives only a partial record from published facts", () => {
  for (const facts of [
    { startDate: "2027-07-07", endDate: "2027-07-10", headliners: ["AMON AMARTH"], lineup: ["Artist"] },
    { startDate: "2027-07-07", endDate: "2027-07-10" },
    { startDate: "2027-07-07" },
    { endDate: "2027-07-10" },
    { headliners: ["AMON AMARTH"] },
    { lineup: ["Artist"] },
  ]) {
    const item = Object.freeze(makeEdition({ ...facts, headliners: Object.freeze(facts.headliners ?? []), lineup: Object.freeze(facts.lineup ?? []) }));
    const before = structuredClone(item);
    assert.equal(editionStatusLabel(item), "partial record");
    assert.deepEqual(item, before);
  }
});

test("genuine TBA retains its label regardless of status or ticket availability", () => {
  for (const status of ["tba", "partial", "confirmed"]) {
    for (const ticketStatus of ["unknown", "unavailable", "available", "low"]) {
      assert.equal(editionStatusLabel(makeEdition({ status, ticketStatus })), "Official dates and lineup TBA");
    }
  }
  assert.equal(editionStatusLabel(makeEdition({ startDate: "", endDate: "" })), "Official dates and lineup TBA");
});

test("explicit non-TBA completeness keeps existing labels with or without published facts", () => {
  for (const completeness of ["partial", "complete"]) {
    for (const facts of [{}, { startDate: "2027-07-07", lineup: ["Artist"] }]) {
      assert.equal(editionStatusLabel(makeEdition({ completeness, ...facts })), `${completeness} record`);
    }
  }
});

test("canonical Rockharz route renders known dates and all 30 artists with a partial badge despite stale TBA", async () => {
  const item = makeEdition({
    slug: "rockharz", name: "Rockharz", startDate: "2027-07-07", endDate: "2027-07-10",
    status: "partial", ticketStatus: "unavailable", headliners: ["AMON AMARTH"],
    lineup: Array.from({ length: 29 }, (_, index) => `Published Artist ${index + 1}`),
  });
  const before = structuredClone(item);
  const html = await renderEdition(item, [makeEdition(), makeEdition({ ...item, editionYear: 2026, completeness: "complete" }), item]);
  assert.match(html, /<h1>Rockharz 2027<\/h1>/);
  assert.match(html, /<p class="detailDate">2027-07-07 — 2027-07-10<\/p>/);
  assert.match(html, /<span class="status partial">partial record<\/span>/);
  const grid = html.match(/<div class="lineupGrid">(.*?)<\/div>/)[1];
  assert.equal((grid.match(/<span>/g) ?? []).length, 30);
  for (const artist of [...item.headliners, ...item.lineup]) assert.ok(grid.includes(`<span>${artist}</span>`));
  assert.doesNotMatch(html, /Official dates and lineup TBA|complete record|No artists published/);
  assert.deepEqual(item, before);
});

test("canonical genuine TBA route retains badge, missing dates, and empty tracking lineup", async () => {
  const html = await renderEdition(makeEdition());
  assert.match(html, /<span class="status tba">Official dates and lineup TBA<\/span>/);
  assert.match(html, /<p class="detailDate">Dates TBA<\/p>/);
  assert.match(html, /No artists published/);
  assert.match(html, /This is an explicit tracking state, not an empty confirmed lineup\./);
  assert.doesNotMatch(html, /lineupGrid|partial record|complete record/);
});

test("canonical route preserves partial facts and explicit completeness for other festivals", async () => {
  for (const facts of [
    { startDate: "2027-07-07" },
    { headliners: ["Headliner"] },
    { lineup: ["Lineup Artist"] },
  ]) {
    const html = await renderEdition(makeEdition(facts));
    assert.match(html, /<span class="status tba">partial record<\/span>/);
    assert.doesNotMatch(html, /Official dates and lineup TBA|complete record/);
    if (!facts.startDate) assert.match(html, /Dates TBA/);
    if (!facts.headliners && !facts.lineup) assert.match(html, /No artists published/);
  }
  for (const completeness of ["partial", "complete"]) {
    const html = await renderEdition(makeEdition({ completeness, status: "confirmed" }));
    assert.ok(html.includes(`<span class="status confirmed">${completeness} record</span>`));
  }
});

test("canonical route still rejects a missing edition", async () => {
  await assert.rejects(renderEdition(makeEdition(), []), /NEXT_NOT_FOUND/);
});
