import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("email delivery has a durable fail-closed verification contract", async () => {
  const [schema, verification, preferences, notifications, component] = await Promise.all([
    readFile("prisma/schema.prisma", "utf8"),
    readFile("lib/email-verification.ts", "utf8"),
    readFile("app/api/notifications/preferences/route.ts", "utf8"),
    readFile("lib/notifications.ts", "utf8"),
    readFile("components/NotificationSettings.tsx", "utf8"),
  ]);
  assert.match(schema, /emailVerifiedAt\s+DateTime\?/);
  assert.match(schema, /tokenHash\s+String\s+@unique/);
  assert.match(verification, /createHash\("sha256"\)/);
  assert.match(verification, /30 \* 60 \* 1000/);
  assert.match(preferences, /channel === "EMAIL" && parsed\.data\.enabled && !user\.emailVerified/);
  assert.match(notifications, /Email address is not verified/);
  for (const copy of ["Verify your account email", "Bestätige deine Konto-Adresse", "Подтвердите адрес аккаунта"]) assert.match(component, new RegExp(copy));
  assert.match(component, /channel === "EMAIL" && !emailVerified/);
  assert.match(component, /t\.verificationSent/);
});
