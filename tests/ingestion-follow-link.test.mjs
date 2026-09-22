import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchSource } from "../lib/ingestion/fetch.ts";

const source = {
  festivalSlug: "tons-of-rock",
  url: "https://festival.example/",
  strategies: ["official_markup"],
  refreshPolicy: "daily",
  enabled: true,
  editionYear: 2027,
  followLinkPattern: "^/news/2027slipp\\d+/?$",
};

test("fetchSource follows the first matching official announcement link", async () => {
  const requests = [];
  const { response, attempts } = await fetchSource(source, {
    fetchImpl: async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? new Response('<a href="/news/2027slipp1">Announcement</a><a href="/news/other">Other</a>', { status: 200 })
        : new Response("official announcement", { status: 200 });
    },
  });
  assert.deepEqual(requests, ["https://festival.example/", "https://festival.example/news/2027slipp1"]);
  assert.equal(attempts, 2);
  assert.equal(await response.text(), "official announcement");
});

test("fetchSource fails closed when the official announcement link is absent", async () => {
  await assert.rejects(
    fetchSource(source, { fetchImpl: async () => new Response('<a href="/news/other">Other</a>', { status: 200 }) }),
    /No official linked page matched/,
  );
});
