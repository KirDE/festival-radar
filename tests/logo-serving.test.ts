import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serveFestivalLogo } from "../lib/catalog/logo-serving.ts";
import { logoFixture } from "./support/logo-fixtures.ts";
const png = await logoFixture();
const jpeg = await logoFixture("image/jpeg");
async function fixture(row = png) { return row; }
function request(tag?: string, method = "GET") {
  return new Request("http://localhost/api/logos/test.png", { method, headers: tag ? { "If-None-Match": tag } : {} });
}

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
  for (const filename of ["../2000trees.png", "2000trees.png/extra", "%2e%2e", "2000trees.jpg", png.sha256, "2000trees.png?x", "2000trees.png\u0000", "2000trees.PNG"]) {
    const response = await serveFestivalLogo(request("*"), filename, async () => { throw new Error("must not query"); });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const file of ["unknown.png", "bloodstock.png"]) {
    assert.equal((await serveFestivalLogo(request(), file, async () => null)).status, 404);
  }
  const missing = await serveFestivalLogo(request("*"), png.file, async () => null);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("etag"), null);
});

test("corrupt bindings and DB failures return generic uncached 503 before conditional matching", async () => {
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

test("valid DB logo updates and new festival slugs do not require an inventory deploy", async () => {
  const logo = await fixture(jpeg);
  assert.equal((await serveFestivalLogo(request(), "new-festival.png", async slug => { assert.equal(slug, "new-festival"); return logo; })).status, 200);
});
