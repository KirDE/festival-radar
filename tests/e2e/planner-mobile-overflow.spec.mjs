import { expect, test } from "@playwright/test";

for (const width of [320, 375, 390]) {
  test(`lineup builder stays inside the mobile page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/en/planner/");

    const heading = page.getByRole("heading", { level: 2, name: "Build your lineup" });
    await expect(heading).toBeVisible();

    const geometry = await page.evaluate(() => {
      const grid = document.querySelector(".playlistFestivalGrid");
      const box = grid?.getBoundingClientRect();
      const labels = [...(grid?.querySelectorAll("label") || [])].map((label) => {
        const labelBox = label.getBoundingClientRect();
        return { left: labelBox.left, right: labelBox.right };
      });
      return {
        viewport: window.innerWidth,
        gridWidth: grid?.scrollWidth,
        gridClientWidth: grid?.clientWidth,
        left: box?.left,
        right: box?.right,
        labels,
      };
    });

    expect(geometry.labels.length, JSON.stringify(geometry)).toBeGreaterThan(0);
    expect(geometry.gridWidth, JSON.stringify(geometry)).toBe(geometry.gridClientWidth);
    expect(geometry.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(0);
    expect(geometry.right, JSON.stringify(geometry)).toBeLessThanOrEqual(width);
    for (const label of geometry.labels) {
      expect(label.left, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.left);
      expect(label.right, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.right);
    }
  });
}
