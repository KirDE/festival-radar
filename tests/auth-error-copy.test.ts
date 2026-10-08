import assert from "node:assert/strict";
import test from "node:test";
import { authErrorMessage } from "../lib/auth-error-copy";

const examples = [
  ["Invalid credentials.", "E-Mail oder Passwort ungültig.", "Неверный адрес почты или пароль."],
  ["This email is already registered.", "Diese E-Mail ist bereits registriert.", "Этот адрес почты уже зарегистрирован."],
  ["Passkey sign-in expired. Please try again.", "Die Passkey-Anfrage ist abgelaufen. Versuche es erneut.", "Запрос паскея истёк. Повторите попытку."],
  ["This email or passkey is already registered.", "Diese E-Mail oder dieser Passkey ist bereits registriert.", "Этот адрес почты или паскей уже зарегистрирован."],
] as const;

test("known password and passkey errors retain actionable localized detail", () => {
  for (const [server, german, russian] of examples) {
    assert.equal(authErrorMessage("de", server, "fallback"), german);
    assert.equal(authErrorMessage("ru", server, "fallback"), russian);
  }
});

test("unknown server or network errors never leak raw English copy", () => {
  for (const error of ["Untrusted request origin.", "Unexpected server text", null, { error: "Internal" }]) {
    assert.equal(authErrorMessage("de", error, "Bitte erneut versuchen."), "Bitte erneut versuchen.");
    assert.equal(authErrorMessage("ru", error, "Повторите попытку."), "Повторите попытку.");
  }
});
