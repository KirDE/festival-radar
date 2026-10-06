import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FestivalLogo } from "../components/FestivalLogo";
import { createFestivalLogoState, failFestivalLogo, festivalLogoInitials, festivalLogoKey } from "../lib/festival-logo-state";

const slug = "synthetic-logo";
test("valid slugs render the DB logo route", () => {
  assert.equal(createFestivalLogoState(slug).src, `/api/logos/${slug}.png`);
  const html = renderToStaticMarkup(createElement(FestivalLogo, { slug, name: "Test Festival", large: true }));
  assert.match(html, /src="\/api\/logos\/synthetic-logo.png"/);
  assert.match(html, /alt="Test Festival logo"/);
  assert.match(html, /width="114" height="84"/);
});

for (const failure of ["DB 503", "missing binding 404", "browser image error"]) {
  test(`${failure} shows initials without a static request or retry loop`, () => {
    const initial = createFestivalLogoState(slug);
    assert.strictEqual(failFestivalLogo(initial, "/stale.png"), initial);
    const terminal = failFestivalLogo(initial, initial.src!);
    assert.equal(terminal.src, null);
    assert.strictEqual(failFestivalLogo(terminal, initial.src!), terminal);
  });
}

test("initials handle whitespace and single words", () => {
  assert.equal(festivalLogoInitials("  Test   Festival Extra "), "TF");
  assert.equal(festivalLogoInitials("Sample"), "S");
  assert.equal(festivalLogoInitials("  "), "");
});

test("slug or name changes remount fresh state; size changes preserve the attempt", () => {
  const props = { slug, name: "Test Festival" };
  const key = FestivalLogo(props).key;
  assert.equal(key, festivalLogoKey(props.slug, props.name));
  assert.equal(FestivalLogo({ ...props, large: true }).key, key);
  for (const changed of [{ ...props, slug: "other-fixture" }, { ...props, name: "Renamed Festival" }]) {
    assert.notEqual(FestivalLogo(changed).key, key);
    assert.equal(createFestivalLogoState(changed.slug).src, `/api/logos/${changed.slug}.png`);
  }
  assert.notEqual(festivalLogoKey("a:b", "c"), festivalLogoKey("a", "b:c"));
});

test("basePath is preserved and invalid path syntax never requests an image", () => {
  const initial = createFestivalLogoState(slug, "/festival-radar");
  assert.equal(initial.src, `/festival-radar/api/logos/${slug}.png`);
  assert.equal(failFestivalLogo(initial, initial.src!).src, null);
  for (const invalid of ["../private", "a/b", "%2f", "a?x=1"]) assert.equal(createFestivalLogoState(invalid).src, null);
});
