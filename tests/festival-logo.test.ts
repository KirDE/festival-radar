import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalLogo } from "../components/FestivalLogo";
import { festivalLogoFallbacks } from "../data/festival-logos";
import { createFestivalLogoState, failFestivalLogo, festivalLogoInitials, festivalLogoKey } from "../data/festival-logo-state";
import inventory from "../data/reviewed-logo-inventory.json";

const reviewed = inventory[0];

test("all reviewed logos initially select the DB route and retain the exact static reference", () => {
  for (const row of inventory) {
    const state = createFestivalLogoState(row.slug);
    assert.equal(state.src, `/api/logos/${row.file}`);
    assert.equal(state.staticSrc, `/logos/${row.file}`);
  }
  const html = renderToStaticMarkup(createElement(FestivalLogo, { slug: reviewed.slug, name: "Test Festival", large: true }));
  assert.match(html, new RegExp(`src="/api/logos/${reviewed.file}"`));
  assert.match(html, /alt="Test Festival logo"/);
  assert.match(html, /width="114" height="84"/);
  assert.doesNotMatch(html, /logo fallback/);
});

// The browser reports these HTTP errors (and decoding/network errors) as onError;
// the image state machine intentionally does not inspect response status codes.
for (const failure of ["DB 503", "missing binding 404", "missing endpoint 404", "browser image error"]) {
  test(`${failure} retries the same reviewed static logo exactly once`, () => {
    const initial = createFestivalLogoState(reviewed.slug);
    const fallback = failFestivalLogo(initial, initial.src!);
    assert.equal(fallback.src, `/logos/${reviewed.file}`);
    assert.strictEqual(failFestivalLogo(fallback, initial.src!), fallback, "duplicate API errors cannot fail the static attempt");
    assert.strictEqual(failFestivalLogo(fallback, "/other.png"), fallback, "stale errors are ignored");
    // No error means the successful static image stays selected.
    assert.equal(fallback.src, fallback.staticSrc);
  });
}

test("static failure shows initials and is terminal, without API/static retry loops", () => {
  const initial = createFestivalLogoState(reviewed.slug);
  const fallback = failFestivalLogo(initial, initial.src!);
  const terminal = failFestivalLogo(fallback, fallback.src!);
  assert.equal(terminal.src, null);
  for (const src of [initial.src!, fallback.src!, "/other.png"]) {
    assert.strictEqual(failFestivalLogo(terminal, src), terminal);
  }
  assert.equal(festivalLogoInitials("  Test   Festival Extra "), "TF");
  assert.equal(festivalLogoInitials("Wacken"), "W");
  assert.equal(festivalLogoInitials("  "), "");
});

test("slug or name changes remount fresh state; size changes keep the existing attempt", () => {
  const props = { slug: reviewed.slug, name: "Test Festival" };
  const initial = createFestivalLogoState(props.slug);
  const fallback = failFestivalLogo(initial, initial.src!);
  const terminal = failFestivalLogo(fallback, fallback.src!);
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

test("new DB bindings can be discovered for previously logo-less festivals", () => {
  for (const slug of festivalLogoFallbacks) {
    const state = createFestivalLogoState(slug);
    assert.equal(state.src, `/api/logos/${slug}.png`);
    const fallback = failFestivalLogo(state, state.src!);
    assert.equal(failFestivalLogo(fallback, fallback.src!).src, null);
  }
});

test("basePath is preserved on the preferred route and its one static retry", () => {
  const initial = createFestivalLogoState(reviewed.slug, "/festival-radar");
  assert.equal(initial.src, `/festival-radar/api/logos/${reviewed.file}`);
  const fallback = failFestivalLogo(initial, initial.src!);
  assert.equal(fallback.src, `/festival-radar/logos/${reviewed.file}`);
  assert.equal(failFestivalLogo(fallback, fallback.src!).src, null);
});

test("new valid slugs use DB while invalid path syntax never makes an image request", () => {
  assert.equal(createFestivalLogoState("new-festival").src, "/api/logos/new-festival.png");
  for (const slug of ["../private", "a/b", "%2f", "a?x=1"]) assert.equal(createFestivalLogoState(slug).src, null);
});
