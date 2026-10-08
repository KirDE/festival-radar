import { expect, test } from "@playwright/test";

const locales = {
  en: { recentSetlists: "Recent setlists", profile: "Profile" },
  de: { recentSetlists: "Aktuelle Setlists", profile: "Profil" },
  ru: { recentSetlists: "Недавние сетлисты", profile: "Профиль" },
};

for (const [language, labels] of Object.entries(locales)) {
  test(`${language} artist routes survive navigation and direct reload`, async ({ page }) => {
    await page.goto(`/${language}/festivals/synthetic-fest/`);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.locator("a.brand")).toHaveAttribute("href", "/");
    if (language !== "en") {
      await expect(page.locator(".planningSection h2")).toHaveText(language === "de" ? "Kalender & Karte" : "Календарь и карта");
      await expect(page.locator(".timetableEmpty strong")).toHaveText(language === "de" ? "Bühnenplan" : "Расписание сцен");
      await expect(page.locator(".localActions option").first()).toHaveText(language === "de" ? "Teilnahme wählen" : "Укажите участие");
      await expect(page.locator(".localActions option")).toHaveText(language === "de"
        ? ["Teilnahme wählen", "Dabei", "Vielleicht", "Nicht dabei"]
        : ["Укажите участие", "Пойду", "Возможно", "Не пойду"]);
      await page.locator(".localActions .favoriteButton").click();
      await expect(page.locator(".localActions .favoriteButton")).toHaveText(language === "de" ? "★ Gespeichert" : "★ Сохранено");
      await expect(page.locator(".localActions a[href*=planner]")).toHaveText(language === "de" ? "Meinen Plan öffnen →" : "Открыть мой план →");
    }
    await page.locator(`a[href="/artists/sample-artist/"]`).first().click();
    await expect(page).toHaveURL(/\/artists\/sample-artist\/$/);
    await expect(page.getByText(labels.recentSetlists, { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(labels.profile, { exact: true })).toBeVisible();

    await page.goto(`/${language}/artists/second-artist/`);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(labels.profile, { exact: true })).toBeVisible();
  });
}

test("language switching preserves the current artist", async ({ page }) => {
  await page.goto("/en/artists/sample-artist/");

  for (const language of ["de", "ru", "en"]) {
    const picker = page.locator(".languagePicker select");
    await expect.poll(() => picker.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps")))).toBe(true);
    await picker.selectOption(language);
    await expect(page).toHaveURL(/\/en\/artists\/sample-artist\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    await expect(page.getByText(locales[language].recentSetlists, { exact: true })).toBeVisible();
  }
});
