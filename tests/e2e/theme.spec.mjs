import { expect, test } from "@playwright/test";

for (const [language, label] of [["en", "Dark mode"], ["de", "Dunkelmodus"], ["ru", "Тёмная тема"]]) {
  test(`[no-db] ${language} theme switches by keyboard and survives navigation and server render`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", route => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
    await page.goto(`/${language}/submit/`);
    const toggle = page.getByRole("switch", { name: label });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(23, 24, 21)");
    const response = await page.request.get(`/${language}/submit/`);
    expect(await response.text()).toContain('data-theme="dark"');
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await page.locator("footer > a").click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeVisible();
      await expect(page.locator(".languagePicker select")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(errors).toEqual([]);
  });
}
