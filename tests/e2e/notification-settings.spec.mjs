import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "notification-account-with-a-long-valid-address@example.test";
const localeEmail = "notification-locales@example.test";
const password = "correct horse battery staple";
const events = [
  "ARTIST_CANCELLED",
  "FESTIVAL_DATE_MOVED",
  "TICKETS_ON_SALE",
  "TICKETS_LOW",
  "TICKETS_SOLD_OUT",
  "TIMETABLE_PUBLISHED",
];

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL || !/(?:test|integration)/i.test(new URL(process.env.DATABASE_URL).pathname)) {
    throw new Error("A test DATABASE_URL is required");
  }
  await db.notificationDelivery.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany({ where: { email: { in: [email, localeEmail] } } });
});

test.afterAll(async () => db.$disconnect());

test("canonical event values persist and authenticated mobile layout does not overflow", async ({ page }) => {
  const registration = await page.request.post("/api/auth/register", { data: { email, password } });
  expect(registration.status()).toBe(201);
  await db.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });

  await page.goto("/en/notifications/");
  await expect(page.getByRole("heading", { name: "Notification settings", exact: true }).first()).toBeVisible();
  await expect(page.locator(".accountButton")).toHaveText(email);

  const selects = page.locator(".notificationForm select");
  const scopeSelect = selects.nth(0);
  const eventSelect = selects.nth(1);
  const channelSelect = selects.nth(2);
  const frequencySelect = selects.nth(3);
  const scopeOptions = await scopeSelect.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  expect(scopeOptions.length).toBeGreaterThan(0);

  for (const [index, eventType] of events.entries()) {
    await eventSelect.selectOption(eventType);
    await scopeSelect.selectOption(index % 2 ? scopeOptions[0] : "");
    await channelSelect.selectOption(["EMAIL", "TELEGRAM", "WEB_PUSH"][index % 3]);
    await frequencySelect.selectOption(["IMMEDIATE", "DAILY", "WEEKLY"][index % 3]);
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/notifications/preferences") && response.request().method() === "PUT" && response.status() === 200);
    await page.getByRole("button", { name: "Save preference" }).click();
    const response = await responsePromise;
    expect(response.status(), `${eventType} should be accepted by the API`).toBe(200);
    expect((await response.json()).preference.eventType).toBe(eventType);
    await expect(page.getByRole("status")).toHaveText("Saved.");
  }

  const persisted = await (await page.request.get("/api/notifications/preferences")).json();
  expect(new Set(persisted.preferences.map((preference) => preference.eventType))).toEqual(new Set(events));
  expect(new Set(persisted.preferences.map((preference) => preference.channel))).toEqual(new Set(["EMAIL", "TELEGRAM", "WEB_PUSH"]));
  expect(new Set(persisted.preferences.map((preference) => preference.frequency))).toEqual(new Set(["IMMEDIATE", "DAILY", "WEEKLY"]));
  expect(new Set(persisted.preferences.map((preference) => preference.festivalId === null ? "global" : "festival"))).toEqual(new Set(["global", "festival"]));

  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      header: document.querySelector(".siteHeader")?.scrollWidth,
      account: document.querySelector(".accountMenu")?.scrollWidth,
    }));
    expect(layout.document, `${width}px: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.viewport);
  }
});

test("operation feedback follows the selected German and Russian language", async ({ page }) => {
  const registration = await page.request.post("/api/auth/register", { data: { email: localeEmail, password } });
  expect(registration.status()).toBe(201);
  await db.user.update({ where: { email: localeEmail }, data: { emailVerifiedAt: new Date() } });

  await page.goto("/en/notifications/");
  await page.locator(".languagePicker select").selectOption("de");
  await page.waitForURL("**/de/notifications/");
  await expect(page.getByRole("heading", { name: "Benachrichtigungen", exact: true }).first()).toBeVisible();
  await page.locator(".notificationForm select").nth(1).selectOption("ARTIST_ADDED");
  await page.locator(".notificationForm .primaryButton").click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert.");

  await page.locator(".languagePicker select").selectOption("ru");
  await page.waitForURL("**/ru/notifications/");
  await expect(page.getByRole("heading", { name: "Настройки уведомлений", exact: true }).first()).toBeVisible();
  await page.locator(".notificationForm select").nth(1).selectOption("ARTIST_ADDED");
  await page.locator(".notificationForm .primaryButton").click();
  await expect(page.getByRole("status")).toHaveText("Сохранено.");
});
