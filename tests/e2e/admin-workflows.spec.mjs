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
  await page.goto("/submit");
  await page.getByLabel("Festival name").fill("Browser Metal Festival");
  await page.getByLabel("Official source URL").fill("https://browser-festival.example.test/official");
  await page.getByLabel("Edition year").fill("2029");
  await page.getByLabel("Notes").fill("Browser-created durable submission");
  await page.getByRole("button", { name: "Send for editorial review" }).click();
  await expect(page.getByRole("status")).toContainText("Received for review");
  expect((await page.request.post("/api/auth/register", { data: { email: "browser-admin@example.test", password: "correct horse battery staple" } })).status()).toBe(201);
  await db.user.update({ where: { email: "browser-admin@example.test" }, data: { role: "ADMIN" } });

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Detected changes" })).toBeVisible();
  await expect(page.locator(".adminRole")).toContainText("Administrator");
  await expect(page.locator(".adminRole")).toContainText("browser-admin@example.test");
  await page.getByRole("button", { name: /Festival submissions/ }).click();
  const submission = page.locator("article.reviewCard").filter({ hasText: "Browser Metal Festival" });
  await expect(submission).toContainText("Browser-created durable submission");
  await submission.getByRole("button", { name: "Approve submission" }).click();
  await expect(submission).toContainText("approved");
  await page.reload();
  await page.getByRole("button", { name: /Festival submissions/ }).click();
  await expect(page.locator("article.reviewCard").filter({ hasText: "Browser Metal Festival" })).toContainText("APPROVED");
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

  const sections = ["Review queue", "Festival submissions", "Festivals & artists", "Links & assets", "Parser diagnostics", "Audit history"];
  for (const width of [320, 375, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const name of sections) {
      await page.getByRole("button", { name: new RegExp(name) }).click();
      const layout = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        nav: document.querySelector(".adminNav")?.scrollWidth,
        main: document.querySelector(".adminMain")?.scrollWidth,
      }));
      expect(layout.document, `${name} at ${width}px: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.viewport);
    }
  }
});

test("editor identity is rendered truthfully", async ({ page }) => {
  expect((await page.request.post("/api/auth/register", { data: { email: "browser-editor@example.test", password: "correct horse battery staple" } })).status()).toBe(201);
  await db.user.update({ where: { email: "browser-editor@example.test" }, data: { role: "EDITOR" } });
  await page.goto("/admin");
  await expect(page.locator(".adminRole")).toContainText("Editor · Review required");
  await expect(page.locator(".adminRole")).toContainText("browser-editor@example.test");
});
