import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalLogo } from "../components/FestivalLogo";
import { festivalLogoFallbacks } from "../data/festival-logos";
import { createFestivalLogoState, failFestivalLogo, festivalLogoInitials, festivalLogoKey } from "../data/festival-logo-state";
import inventory from "../data/reviewed-logo-inventory.json";

const reviewed = inventory[0];

test("all reviewed logos initially select the DB route", () => {
  for (const row of inventory) {
    const state = createFestivalLogoState(row.slug);
    assert.equal(state.src, `/api/logos/${row.file}`);
  }
  const html = renderToStaticMarkup(createElement(FestivalLogo, { slug: reviewed.slug, name: "Test Festival", large: true }));
  assert.match(html, new RegExp(`src="/api/logos/${reviewed.file}"`));
  assert.match(html, /alt="Test Festival logo"/);
  assert.match(html, /width="114" height="84"/);
  assert.doesNotMatch(html, /logo fallback/);
});

// HTTP, network and decoding failures all enter the same browser onError handler.
for (const failure of ["DB 503", "missing binding 404", "missing endpoint 404", "network/decoding error"]) {
  test(`${failure} goes straight to terminal initials`, () => {
    const initial = createFestivalLogoState(reviewed.slug);
    assert.strictEqual(failFestivalLogo(initial, "/other.png"), initial);
    const terminal = failFestivalLogo(initial, initial.src!);
    assert.deepEqual(terminal, { src: null });
    assert.strictEqual(failFestivalLogo(terminal, initial.src!), terminal);
    assert.equal(festivalLogoInitials("  Test   Festival Extra "), "TF");
    assert.equal(festivalLogoInitials("Wacken"), "W");
    assert.equal(festivalLogoInitials("  "), "");
  });
}

test("slug or name changes remount fresh state; size changes keep the existing attempt", () => {
  const props = { slug: reviewed.slug, name: "Test Festival" };
  const initial = createFestivalLogoState(props.slug);
  const terminal = failFestivalLogo(initial, initial.src!);
  assert.equal(terminal.src, null);
  const key = FestivalLogo(props).key;
  assert.equal(key, festivalLogoKey(props.slug, props.name));
  assert.equal(FestivalLogo({ ...props, large: true }).key, key);
  for (const changed of [{ ...props, slug: inventory[1].slug }, { ...props, name: "Renamed Festival" }]) {
    assert.notEqual(FestivalLogo(changed).key, key);
    assert.equal(createFestivalLogoState(changed.slug).src, `/api/logos/${changed.slug}.png`);
  }
  assert.notEqual(festivalLogoKey("a:b", "c"), festivalLogoKey("a", "b:c"));
});

test("the five initials-only festivals never request either image route", () => {
  assert.deepEqual([...festivalLogoFallbacks].sort(), ["bloodstock", "brutal-assault", "pistoia-blues", "polandrock", "tolminator"]);
  for (const slug of festivalLogoFallbacks) {
    assert.deepEqual(createFestivalLogoState(slug, "/festival-radar"), { src: null });
    const html = renderToStaticMarkup(createElement(FestivalLogo, { slug, name: "Test Festival" }));
    assert.match(html, /role="img" aria-label="Test Festival logo fallback">TF<\/span>/);
    assert.doesNotMatch(html, /<img\b/);
  }
  assert.notEqual(FestivalLogo({ slug: "bloodstock", name: "Old Name" }).key, FestivalLogo({ slug: "bloodstock", name: "New Name" }).key);
  const renamed = renderToStaticMarkup(createElement(FestivalLogo, { slug: "bloodstock", name: "New Name" }));
  assert.match(renamed, /aria-label="New Name logo fallback">NN<\/span>/);
  assert.notEqual(FestivalLogo({ slug: "bloodstock", name: "Test Festival" }).key, FestivalLogo({ slug: reviewed.slug, name: "Test Festival" }).key);
});

test("basePath prefixes only the DB request; failure is terminal", () => {
  const initial = createFestivalLogoState(reviewed.slug, "/festival-radar");
  assert.equal(initial.src, `/festival-radar/api/logos/${reviewed.file}`);
  assert.equal(failFestivalLogo(initial, initial.src!).src, null);
});

test("unreviewed slugs fail closed without any image request", () => {
  for (const slug of ["not-reviewed", "constructor", "__proto__", "../2000trees", "2000trees.png"]) {
    assert.deepEqual(createFestivalLogoState(slug), { src: null });
    const html = renderToStaticMarkup(createElement(FestivalLogo, { slug, name: "Unknown Festival" }));
    assert.match(html, />UF<\/span>/);
    assert.doesNotMatch(html, /<img\b/);
  }
});

// Exercise the actual localized card and detail trees, including all 52 festivals.
for (const language of ["en", "de", "ru"] as const) {
  test(`${language} cards/detail render the 47 DB logos and five initials`, async () => {
    const { LanguageProvider } = await import("../components/LanguageProvider");
    const { LocalPlannerProvider } = await import("../components/LocalPlanner");
    const { FestivalExplorer } = await import("../components/FestivalExplorer");
    const { FestivalDetail } = await import("../components/FestivalDetail");
    const { festivals } = await import("../data/festivals");
    const wrap = (child: ReturnType<typeof createElement>) => createElement(LanguageProvider, { initialLanguage: language, children: createElement(LocalPlannerProvider, { children: child }) });
    const cards = renderToStaticMarkup(wrap(createElement(FestivalExplorer, { festivals })));
    assert.equal((cards.match(/class="festivalLogo /g) ?? []).length, 52);
    for (const row of inventory) assert.ok(cards.includes(`src="/api/logos/${row.file}"`), `${language}: ${row.slug}`);
    assert.equal((cards.match(/logo fallback/g) ?? []).length, 5);
    assert.doesNotMatch(cards, /src="\/logos\//);
    for (const slug of [reviewed.slug, ...festivalLogoFallbacks]) {
      const item = festivals.find((row) => row.slug === slug)!;
      const detail = renderToStaticMarkup(wrap(createElement(FestivalDetail, { item, festivals, artistSlugs: {} })));
      if (festivalLogoFallbacks.has(slug)) assert.ok(detail.includes(renderToStaticMarkup(createElement(FestivalLogo, { slug, name: item.name, large: true }))));
      else assert.ok(detail.includes(`src="/api/logos/${reviewed.file}"`));
    }
  });
}
