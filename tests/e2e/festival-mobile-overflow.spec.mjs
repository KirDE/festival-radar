import { expect, test } from "@playwright/test";

test("search clear icon resets query and restores input focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/");
  const search = page.getByRole("textbox", { name: "Search festivals, artists or cities" });
  await search.fill("not-a-real-festival");
  const clear = page.getByRole("button", { name: "Clear search" });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(clear).toHaveCount(0);
});

test("square festival logos fit inside mobile card tiles without clipping", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const squarePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==", "base64");
  await page.route("**/api/logos/synthetic-fest.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: squarePng }));
  await page.goto("/en/");
  const tile = page.locator(".festivalCard").filter({ hasText: "Synthetic Fest" }).locator(".festivalLogo");
  const image = tile.locator("img");
  await expect(image).toHaveJSProperty("naturalWidth", 1);
  const fit = await tile.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const imageBox = node.querySelector("img").getBoundingClientRect();
    return { left: imageBox.left - box.left, top: imageBox.top - box.top,
      right: box.right - imageBox.right, bottom: box.bottom - imageBox.bottom };
  });
  for (const inset of Object.values(fit)) expect(inset, JSON.stringify(fit)).toBeGreaterThanOrEqual(8);
});

test("missing festival logo initials contrast against the white tile in a dark hero", async ({ page }) => {
  await page.route("**/api/logos/synthetic-fest.png", (route) => route.fulfill({ status: 404 }));
  await page.goto("/en/festivals/synthetic-fest/");
  const fallback = page.locator(".detailHero .festivalLogo span[role=img]");
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveText("SF");
  const styles = await fallback.evaluate((node) => ({
    foreground: getComputedStyle(node).color,
    background: getComputedStyle(node.parentElement).backgroundColor,
  }));
  expect(styles).toEqual({ foreground: "rgb(23, 23, 18)", background: "rgb(255, 255, 255)" });
});

for (const width of [320, 375, 390]) {
  test(`similar festivals stays inside the mobile page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/en/festivals/synthetic-fest/");

    const recommendations = page.locator(".recommendations");
    await expect(recommendations.getByRole("heading", { name: "Similar festivals" })).toBeVisible();
    await expect(recommendations.getByRole("link")).toHaveCount(3);

    const geometry = await page.evaluate(() => {
      const recommendations = document.querySelector(".recommendations");
      const box = recommendations?.getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        recommendations: recommendations?.scrollWidth,
        recommendationsClient: recommendations?.clientWidth,
        left: box?.left,
        right: box?.right,
        columns: recommendations ? getComputedStyle(recommendations).gridTemplateColumns : "",
      };
    });

    expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.body, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.recommendations, JSON.stringify(geometry)).toBe(geometry.recommendationsClient);
    expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
    expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(width);
    expect(geometry.columns.split(" ")).toHaveLength(1);
    await expect(page.getByRole("heading", { level: 1, name: "Synthetic Fest" })).toBeInViewport();
  });
}
