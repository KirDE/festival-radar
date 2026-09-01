import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const admin = readFileSync(new URL("../components/AdminConsole.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/AppShell.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../components/LanguageProvider.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("admin uses the single shell main and a labelled navigation landmark", () => {
  assert.equal((admin.match(/<main\b/g) ?? []).length, 0);
  assert.match(shell, /<main id="main-content"/);
  assert.match(admin, /<nav className="adminNav" aria-label=\{ta\("navigation"\)\}/);
  assert.match(shell, /!admin && <SiteHeader/);
  assert.match(shell, /!admin && <SiteFooter/);
});

test("admin has complete EN, DE and RU catalogs and language control", () => {
  for (const language of ["en", "de", "ru"]) assert.match(catalog, new RegExp(`\\n  [\"']?${language}[\"']?: \\{`));
  assert.match(admin, /setLanguage\(event\.target\.value as Language\)/);
  assert.match(admin, /aria-live="polite"/);
});

test("admin exposes visible keyboard focus and responsive navigation", () => {
  assert.match(css, /\.adminShell :is\([^}]+\):focus-visible/);
  assert.match(css, /\.adminNav\{position:relative;height:auto;overflow-x:auto\}/);
  assert.match(css, /grid-template-columns:260px minmax\(0,1fr\)/);
  assert.match(css, /\.adminNav,.adminMain[^}]+min-width:0/);
  assert.match(css, /overflow-wrap:anywhere/);
});

test("admin renders the authenticated operator role instead of a hard-coded editor label", () => {
  assert.match(admin, /operator\.role === "ADMIN" \? "roleAdmin" : operator\.role === "EDITOR" \? "roleEditor" : "roleUser"/);
  assert.match(admin, /operator\.email/);
  assert.match(catalog, /roleAdmin: "Administrator"/);
  assert.match(catalog, /roleEditor: "Editor · Review required"/);
});
