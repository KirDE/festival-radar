import { expect, test } from "@playwright/test";

async function expectNoDocumentOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(Math.max(geometry.documentWidth, geometry.bodyWidth)).toBeLessThanOrEqual(geometry.viewportWidth);
}

async function edgeMarkerIndexes(markers) {
  const positions = await markers.evaluateAll((elements) =>
    elements.map((element, index) => ({
      index,
      left: Number.parseFloat(getComputedStyle(element.parentElement).left),
    })),
  );
  positions.sort((a, b) => a.left - b.left);
  const center = positions.reduce((closest, position) =>
    Math.abs(position.left - 50) < Math.abs(closest.left - 50) ? position : closest,
  );
  return [positions[0].index, center.index, positions.at(-1).index];
}

for (const width of [320, 375, 390]) {
  test(`mobile map popup stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/planner/");
    const markers = page.locator(".mapMarker summary");
    await expect(markers).toHaveCount(16);
    await expectNoDocumentOverflow(page);

    for (const index of await edgeMarkerIndexes(markers)) {
      const marker = markers.nth(index);
      await marker.click();
      await expect(marker.locator("xpath=..")).toHaveAttribute("open", "");
      const panel = marker.locator("xpath=../div");
      await expect(panel).toBeVisible();
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.width).toBeGreaterThanOrEqual(width - 40);
      const firstLink = panel.locator("a").first();
      await expect(firstLink).toHaveAttribute("href", /^\/festivals\/.+\/$/);
      await expect(firstLink).toBeInViewport();
      await expectNoDocumentOverflow(page);
      await marker.click();
      await expect(panel).toBeHidden();
    }

    const austria = markers.filter({ hasText: "AT" });
    await austria.click();
    const festivalLink = austria.locator("xpath=../div/a").first();
    const route = await festivalLink.getAttribute("href");
    expect(route).toMatch(/^\/festivals\/.+\/$/);
    await festivalLink.focus();
    await expect(festivalLink).toBeFocused();
    await festivalLink.press("Enter");
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/planner\/$/);
    await expectNoDocumentOverflow(page);

    const mapBox = await page.locator(".europeMap").boundingBox();
    expect(mapBox.x).toBeGreaterThanOrEqual(0);
    expect(mapBox.x + mapBox.width).toBeLessThanOrEqual(width);
  });
}

test("desktop map positioning and links remain operable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/planner/");
  const marker = page.locator(".mapMarker summary").filter({ hasText: "AT" });
  await marker.click();
  const panel = marker.locator("xpath=../div");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("link", { name: /Nova Rock/ })).toHaveAttribute("href", "/festivals/nova-rock/");
  expect(await marker.locator("xpath=..").evaluate((element) => getComputedStyle(element).transform)).not.toBe("none");
  await expectNoDocumentOverflow(page);
});
