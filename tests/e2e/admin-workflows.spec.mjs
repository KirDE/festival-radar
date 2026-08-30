import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL || !/(?:test|integration)/i.test(new URL(process.env.DATABASE_URL).pathname)) throw new Error("A test DATABASE_URL is required");
  await db.$executeRawUnsafe('TRUNCATE TABLE "AdminChange", "AdminDraft", "AdminParserRun", "AdminResourceState", "AdminAuditEntry", "Session", "User" CASCADE');
});

test.afterAll(async () => db.$disconnect());

test("admin edits, reviews, diagnostics and audit survive reload", async ({ page }) => {
  await expect((await page.request.get("/api/admin")).status()).toBe(403);
  expect((await page.request.post("/api/auth/register", { data: { email: "browser-admin@example.test", password: "correct horse battery staple" } })).status()).toBe(201);
  await db.user.update({ where: { email: "browser-admin@example.test" }, data: { role: "ADMIN" } });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Detected changes" })).toBeVisible();
  await page.getByRole("button", { name: "Festivals & artists" }).click();
  await page.getByLabel("City").fill("Wacken E2E City");
  await page.getByRole("button", { name: "Save festival draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  await page.getByPlaceholder("Find an artist").fill("Electric Callboy");
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.getByLabel("Canonical name").fill("Electric Callboy E2E");
  await page.getByRole("button", { name: "Save artist draft" }).click();
  await expect(page.getByRole("status")).toContainText("persisted and queued");

  await page.getByRole("button", { name: "Links & assets" }).click();
  await page.getByLabel("Tickets URL").fill("https://tickets.example.test/wacken");
  await page.getByLabel("Logo URL").fill("https://assets.example.test/wacken.svg");
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/admin") && response.request().method() === "POST" && response.request().postData()?.includes('"resourceKind":"link"')),
    page.getByRole("button", { name: "Save links draft" }).click(),
  ]);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/admin") && response.request().method() === "POST" && response.request().postData()?.includes('"resourceKind":"asset"')),
    page.getByRole("button", { name: "Save asset draft" }).click(),
  ]);

  await page.reload();
  await page.getByRole("button", { name: "Review queue" }).click();
  const cityChange = page.locator("article.reviewCard").filter({ hasText: "Wacken E2E City" });
  await expect(cityChange).toBeVisible();
  await cityChange.getByRole("button", { name: "Approve change" }).click();
  await expect(cityChange).toContainText("approved");

  await page.reload();
  await page.getByRole("button", { name: "Audit history" }).click();
  await expect(page.getByText("CHANGE_APPROVED")).toBeVisible();
  await expect(page.getByText("DRAFT_SAVED").first()).toBeVisible();

  await db.adminParserRun.create({ data: { festivalSlug: "wacken-open-air", sourceId: "e2e-source", adapter: "e2e-adapter", status: "FAILED", finishedAt: new Date(), durationMs: 17, message: "E2E adapter failure", log: [{ message: "fixture" }] } });
  await page.reload();
  await page.getByRole("button", { name: "Parser diagnostics" }).click();
  await expect(page.getByText("E2E adapter failure")).toBeVisible();

  const snapshot = await (await page.request.get("/api/admin")).json();
  expect(snapshot.drafts).toHaveLength(4);
  expect(snapshot.resources.find((item) => item.resourceKind === "FESTIVAL")?.values.city).toBe("Wacken E2E City");
  expect(new Set(snapshot.drafts.map((item) => item.resourceKind))).toEqual(new Set(["FESTIVAL", "ARTIST", "LINK", "ASSET"]));
});
