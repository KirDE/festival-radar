import type { Language } from "./language-preference";

type ErrorKey = "credentials" | "registrationInput" | "duplicateEmail" | "emailRequired" | "passkeyUnavailable" | "passkeyInvalid" | "passkeyExpired" | "passkeyFailed" | "duplicatePasskey";

// Exact API messages are an existing wire contract. Unknown or new errors never
// appear verbatim in a translated interface; they fall back to generic copy.
const apiErrors: Record<string, ErrorKey> = {
  "Invalid credentials.": "credentials",
  "A valid email and a password of at least 12 characters are required.": "registrationInput",
  "This email is already registered.": "duplicateEmail",
  "A valid email is required.": "emailRequired",
  "Passkey sign-in is unavailable.": "passkeyUnavailable",
  "Passkey registration is unavailable.": "passkeyUnavailable",
  "Invalid passkey response.": "passkeyInvalid",
  "Passkey sign-in expired. Please try again.": "passkeyExpired",
  "Passkey registration expired. Please try again.": "passkeyExpired",
  "Passkey sign-in failed.": "passkeyFailed",
  "Passkey registration could not be verified.": "passkeyFailed",
  "This email or passkey is already registered.": "duplicatePasskey",
};

const messages: Record<Language, Record<ErrorKey, string>> = {
  en: { credentials: "Invalid email or password.", registrationInput: "Enter a valid email and a password of at least 12 characters.", duplicateEmail: "This email is already registered.", emailRequired: "Enter a valid email.", passkeyUnavailable: "Passkey service is unavailable. Try again later.", passkeyInvalid: "The passkey response was invalid. Try again.", passkeyExpired: "The passkey request expired. Try again.", passkeyFailed: "Passkey verification failed. Try again.", duplicatePasskey: "This email or passkey is already registered." },
  de: { credentials: "E-Mail oder Passwort ungültig.", registrationInput: "Gib eine gültige E-Mail und ein Passwort mit mindestens 12 Zeichen ein.", duplicateEmail: "Diese E-Mail ist bereits registriert.", emailRequired: "Gib eine gültige E-Mail ein.", passkeyUnavailable: "Der Passkey-Dienst ist nicht verfügbar. Versuche es später erneut.", passkeyInvalid: "Die Passkey-Antwort war ungültig. Versuche es erneut.", passkeyExpired: "Die Passkey-Anfrage ist abgelaufen. Versuche es erneut.", passkeyFailed: "Die Passkey-Prüfung ist fehlgeschlagen. Versuche es erneut.", duplicatePasskey: "Diese E-Mail oder dieser Passkey ist bereits registriert." },
  ru: { credentials: "Неверный адрес почты или пароль.", registrationInput: "Введите корректный адрес почты и пароль не короче 12 символов.", duplicateEmail: "Этот адрес почты уже зарегистрирован.", emailRequired: "Введите корректный адрес почты.", passkeyUnavailable: "Сервис паскеев недоступен. Повторите попытку позже.", passkeyInvalid: "Некорректный ответ паскея. Повторите попытку.", passkeyExpired: "Запрос паскея истёк. Повторите попытку.", passkeyFailed: "Не удалось проверить паскей. Повторите попытку.", duplicatePasskey: "Этот адрес почты или паскей уже зарегистрирован." },
};

export function authErrorMessage(language: Language, apiMessage: unknown, fallback: string): string {
  const key = typeof apiMessage === "string" ? apiErrors[apiMessage] : undefined;
  return key ? messages[language][key] : fallback;
}
