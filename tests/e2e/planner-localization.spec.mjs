import { expect, test } from "@playwright/test";

const locales = {
  en: { title: "Your 2027 plan", notifications: "Notifications", calendar: "Festival calendar", map: "Festival map", clear: "Clear local data", account: "Account sync", playlist: "Build your lineup", previous: "Previous month" },
  de: { title: "Dein Plan für 2027", notifications: "Benachrichtigungen", calendar: "Festivalkalender", map: "Festivalkarte", clear: "Lokale Daten löschen", account: "Konto-Synchronisierung", playlist: "Stelle dein Line-up zusammen", previous: "Vorheriger Monat" },
  ru: { title: "Ваш план на 2027 год", notifications: "Уведомления", calendar: "Календарь фестивалей", map: "Карта фестивалей", clear: "Удалить локальные данные", account: "Синхронизация аккаунта", playlist: "Соберите свой лайнап", previous: "Предыдущий месяц" },
};

for (const [locale, copy] of Object.entries(locales)) {
  test(`${locale} planner renders localized navigation, headings and controls`, async ({ page }) => {
    await page.goto(`/${locale}/planner/`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}/planner/$`));
    await expect(page.getByRole("heading", { level: 1, name: copy.title })).toBeVisible();
    await expect(page.getByRole("navigation").getByText(copy.notifications, { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("link", { name: locale === "en" ? "My plan" : locale === "de" ? "Mein Plan" : "Мой план" })).toHaveAttribute("href", `/${locale}/planner/`);
    await expect(page.getByRole("heading", { level: 2, name: copy.calendar })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: copy.map })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.previous })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.clear })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: copy.account })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: copy.playlist })).toBeVisible();
  });
}
