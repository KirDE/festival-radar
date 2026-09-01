import { expect, test } from "@playwright/test";

const locales = {
  en: { recentSetlists: "Recent setlists", profile: "Profile" },
  de: { recentSetlists: "Aktuelle Setlists", profile: "Profil" },
  ru: { recentSetlists: "Недавние сетлисты", profile: "Профиль" },
};

for (const [language, labels] of Object.entries(locales)) {
  test(`${language} artist routes survive navigation and direct reload`, async ({ page }) => {
    await page.goto(`/${language}/festivals/wacken-open-air/`);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await page.locator(`a[href="/${language}/artists/electric-callboy/"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${language}/artists/electric-callboy/$`));
    await expect(page.getByText(labels.recentSetlists, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(labels.profile, { exact: true })).toBeVisible();

    await page.goto(`/${language}/artists/abbie-falls/`);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(labels.profile, { exact: true })).toBeVisible();
  });
}

test("language switching preserves the current artist", async ({ page }) => {
  await page.goto("/en/artists/electric-callboy/");

  for (const language of ["de", "ru", "en"]) {
    const picker = page.locator(".languagePicker select");
    await expect.poll(() => picker.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps")))).toBe(true);
    await picker.selectOption(language);
    await expect(page).toHaveURL(new RegExp(`/${language}/artists/electric-callboy/$`));
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(locales[language].recentSetlists, { exact: true })).toBeVisible();
  }
});
