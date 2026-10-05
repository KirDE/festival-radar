import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import inventory from "../data/reviewed-logo-inventory.json";
import { databaseLogoPath, reviewedLogoFile } from "../data/logo-serving.ts";
import { festivalLogoPath, festivalLogoFallbacks } from "../data/festival-logos.ts";
import { serveFestivalLogo } from "../lib/catalog/logo-serving.ts";

const png = inventory.find((row) => row.mimeType === "image/png")!;
const jpeg = inventory.find((row) => row.mimeType === "image/jpeg")!;
async function fixture(row = png) {
  return { ...row, bytes: await readFile(new URL(`../public/logos/${row.file}`, import.meta.url)), etag: `"${row.sha256}"` };
}
function request(tag?: string, method = "GET") {
  return new Request("http://localhost/api/logos/test.png", { method, headers: tag ? { "If-None-Match": tag } : {} });
}

test("exact public references map to reviewed filenames; static references and initials stay intact", () => {
  for (const row of inventory) {
    const reference = festivalLogoPath(row.slug)!;
    assert.equal(reference, `/logos/${row.file}`);
    assert.equal(databaseLogoPath(reference), `/api/logos/${row.file}`);
  }
  for (const slug of festivalLogoFallbacks) {
    assert.equal(festivalLogoPath(slug), null);
    assert.equal(databaseLogoPath(`/logos/${slug}.png`), null);
  }
  for (const reference of ["https://example.org/logos/2000trees.png", "/private/2000trees.png", "/logos/../2000trees.png", "/logos/%32%30%30%30trees.png", "/logos/2000trees.png?x=1"]) {
    assert.equal(databaseLogoPath(reference), null);
  }
});

test("PNG/JPEG use actual stored MIME, exact bytes, ETag and revalidation cache policy", async () => {
  for (const row of [png, jpeg]) {
    const logo = await fixture(row);
    const response = await serveFestivalLogo(request(), row.file, async (slug) => {
      assert.equal(slug, row.slug);
      return logo;
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), row.mimeType);
    assert.equal(response.headers.get("content-length"), String(row.sizeBytes));
    assert.equal(response.headers.get("etag"), logo.etag);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), logo.bytes);
  }
});

test("If-None-Match handles strong, weak, lists and wildcard with bodyless 304", async () => {
  const logo = await fixture();
  for (const tag of [logo.etag, `W/${logo.etag}`, `"other", W/${logo.etag}`, "*", `  ${logo.etag}  `]) {
    const response = await serveFestivalLogo(request(tag), png.file, async () => logo);
    assert.equal(response.status, 304, tag);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("etag"), logo.etag);
    assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(response.headers.get("content-length"), null);
  }
  for (const tag of ['"other"', logo.sha256, `w/${logo.etag}`]) {
    assert.equal((await serveFestivalLogo(request(tag), png.file, async () => logo)).status, 200);
  }
  const head = await serveFestivalLogo(request(undefined, "HEAD"), png.file, async () => logo);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(png.sizeBytes));
  assert.equal(await head.text(), "");
});

test("invalid filenames never query DB; missing bindings return uncached 404 even for wildcard", async () => {
  for (const filename of ["../2000trees.png", "2000trees.png/extra", "%2e%2e", "2000trees.jpg", png.sha256, "unknown.png", "bloodstock.png", "2000trees.png?x", "2000trees.png\u0000", "2000trees.PNG"]) {
    assert.equal(reviewedLogoFile(filename), null);
    const response = await serveFestivalLogo(request("*"), filename, async () => { throw new Error("must not query"); });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const missing = await serveFestivalLogo(request("*"), png.file, async () => null);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("etag"), null);
});

test("unreviewed/corrupt bindings and DB failures return generic uncached 503 before conditional matching", async () => {
  const logo = await fixture();
  const corrupted = Buffer.from(logo.bytes);
  corrupted[25] ^= 1;
  for (const invalid of [
    { ...logo, sha256: "a".repeat(64) },
    { ...logo, mimeType: "text/html" },
    { ...logo, bytes: logo.bytes.subarray(1) },
    { ...logo, bytes: corrupted },
  ]) {
    const response = await serveFestivalLogo(request("*"), png.file, async () => invalid);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("etag"), null);
  }
  const failed = await serveFestivalLogo(request(), png.file, async () => { throw new Error("private DB details"); });
  assert.equal(failed.status, 503);
  assert.equal(await failed.text(), "");
});
