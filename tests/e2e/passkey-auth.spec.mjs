import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const email = "passkey-browser@example.test";

test.beforeEach(async () => {
  await db.user.deleteMany({ where: { email } });
});

test.afterAll(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

test("creates an account and signs back in with a discoverable passkey", async ({ context, page }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page.getByRole("tab", { name: "Create account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.locator(".accountButton")).toHaveText(email);

  const stored = await db.user.findUniqueOrThrow({ where: { email }, include: { passkeys: true } });
  expect(stored.passwordHash).toBeNull();
  expect(stored.passkeys).toHaveLength(1);
  expect(stored.passkeys[0].publicKey.byteLength).toBeGreaterThan(0);

  await page.locator(".accountButton").click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".accountButton")).toHaveText("Account");

  await page.locator(".accountButton").click();
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(page.locator(".accountButton")).toHaveText(email);
  await expect.poll(async () => (await db.passkey.findUniqueOrThrow({ where: { id: stored.passkeys[0].id } })).lastUsedAt).not.toBeNull();

  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
});
