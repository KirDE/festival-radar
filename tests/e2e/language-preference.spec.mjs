import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

async function switchWithoutNavigation(page, language, selector = ".languagePicker select") {
  await expect.poll(() => page.locator(selector).evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps")))).toBe(true);
  const url = page.url();
  await page.evaluate(() => { window.__languageDocument = "same-document"; });
  await page.locator(selector).selectOption(language);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => window.__languageDocument)).toBe("same-document");
  expect(await page.evaluate(() => localStorage.getItem("festival-radar-language"))).toBe(language);
}

test("[no-db] prefixed switch preserves query/hash and preference survives reload and navigation", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({status:401,contentType:"application/json",body:"{}"}));
  await page.goto("/en/submit/?filter=keep&filter=second#main-content");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  for (const language of ["de", "ru", "en", "ru"]) await switchWithoutNavigation(page, language);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://festivals.kir-it.de/en/submit/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Предложить фестиваль");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  // An explicit URL locale remains the SSR/SEO locale; the saved UI choice wins after hydration.
  await page.goto("/de/submit/?next=keep#main-content");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator(".languagePicker select")).toHaveValue("ru");
  await page.goto("/submit/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator(".languagePicker select")).toHaveValue("ru");
});

test("[no-db] brand and submission navigation stay bare after a language choice", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));
  await page.goto("/de/submit/?source=header#main-content");
  await switchWithoutNavigation(page, "ru");
  await expect(page.locator("a.brand")).toHaveAttribute("href", "/");
  await expect(page.locator("header nav a").first()).toHaveAttribute("href", "/");
  await expect(page.locator("header nav a").nth(1)).toHaveAttribute("href", "/planner/");
  await expect(page.locator("footer > a")).toHaveAttribute("href", "/submit/");
  await page.locator("footer > a").click();
  await expect(page).toHaveURL(/\/submit\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Предложить фестиваль");
  await expect(page.getByRole("button", { name: "Отправить редакции" })).toBeVisible();
  await page.locator(".submissionForm [name=name]").fill("Example Festival");
  await page.locator(".submissionForm [name=officialUrl]").fill("https://example.test/");
  await page.locator(".submissionForm [name=year]").fill("2027");
  await page.getByRole("button", { name: "Отправить редакции" }).click();
  await expect(page.locator(".submissionForm [role=status]")).toContainText("Не удалось отправить.");
  await page.getByRole("button", { name: "Аккаунт" }).click();
  await expect(page.getByRole("tab", { name: "Войти" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/de\/submit\/\?source=header#main-content$/);
  await expect(page.locator(".languagePicker select")).toHaveValue("ru");
});

for (const [routeLanguage, selectedLanguage, planLabel] of [["de", "ru", "Мой план"], ["ru", "de", "Mein Plan"]]) {
  test("brand click from /" + routeLanguage + "/ detail keeps the selected " + selectedLanguage + " language on bare routes", async ({ page }) => {
    await page.goto("/" + routeLanguage + "/festivals/synthetic-fest/");
    const origin = new URL(page.url()).origin;
    await switchWithoutNavigation(page, selectedLanguage);
    await page.locator("a.brand").click();
    await expect(page).toHaveURL(origin + "/");
    await expect(page.locator("html")).toHaveAttribute("lang", selectedLanguage);
    await expect(page.locator(".languagePicker select")).toHaveValue(selectedLanguage);
    await page.getByRole("navigation").getByRole("link", { name: planLabel, exact: true }).click();
    await expect(page).toHaveURL(origin + "/planner/");
    await expect(page.locator("html")).toHaveAttribute("lang", selectedLanguage);
    await page.reload();
    await expect(page.locator(".languagePicker select")).toHaveValue(selectedLanguage);
    await expect(page.locator("html")).toHaveAttribute("lang", selectedLanguage);
  });
}

test("[no-db] fresh prefixed links honor their locale and bare HTML reads the preference cookie", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({status:401,contentType:"application/json",body:"{}"}));
  await page.goto("/de/submit/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.waitForFunction(() => document.cookie.includes("festival-radar-language=de"));
  const response = await page.request.get("/submit/");
  expect((await response.text()).includes("Festival vorschlagen")).toBe(true);
  // Next dev overrides middleware caching with no-cache; production retains private, no-store.
  expect(response.headers()["cache-control"]).toMatch(/private.*no-store|no-cache.*must-revalidate/);
  expect(response.headers()["set-cookie"]).toBeUndefined();
});

test("[no-db] blocked language-preference storage still restores from the cookie", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({status:401,contentType:"application/json",body:"{}"}));
  await page.addInitScript(() => {
    const storage = window.localStorage;
    const get = storage.getItem.bind(storage);
    const set = storage.setItem.bind(storage);
    storage.getItem = (key) => key === "festival-radar-language" ? (() => { throw new Error("Preference storage blocked"); })() : get(key);
    storage.setItem = (key, value) => key === "festival-radar-language" ? (() => { throw new Error("Preference storage blocked"); })() : set(key, value);
  });
  await page.goto("/en/submit/?keep=query#main-content");
  const url = page.url();
  await page.locator(".languagePicker select").selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang","de");
  expect(page.url()).toBe(url);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang","de");
});

test("prefixed planner switching preserves the plan, query and hash on reload and navigation", async ({ page }) => {
  await page.goto("/en/planner/?filter=keep#main-content");
  await page.waitForFunction(() => document.cookie.includes("festival-radar-language=en"));
  await switchWithoutNavigation(page,"de");
  await expect(page.getByRole("heading",{level:1})).toHaveText("Dein Plan für 2027");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang","de");
  await page.getByRole("navigation").getByRole("link",{name:"Benachrichtigungen",exact:true}).click();
  await expect(page).toHaveURL(/\/notifications\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang","de");
});


test("[no-db] localStorage restores the choice when cookie access is blocked", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({status:401,contentType:"application/json",body:"{}"}));
  await page.addInitScript(() => Object.defineProperty(document,"cookie",{
    get:()=>{throw new Error("Cookies blocked");},set:()=>{throw new Error("Cookies blocked");},
  }));
  await page.goto("/en/submit/?keep=query#main-content");
  await switchWithoutNavigation(page,"ru");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang","ru");
  await expect(page).toHaveURL(/\/en\/submit\/\?keep=query#main-content$/);
});
