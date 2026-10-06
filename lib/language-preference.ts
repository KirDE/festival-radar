export type Language = "en" | "de" | "ru";
export const LANGUAGE_PREFERENCE_KEY = "festival-radar-language";
export const LANGUAGE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "de" || value === "ru";
}

/** Explicit saved choices survive navigation; a fresh visitor uses the route locale. */
export function preferredLanguage(stored: unknown, cookie: unknown, initial: Language | undefined, fallback: Language): Language {
  return isLanguage(stored) ? stored : isLanguage(cookie) ? cookie : initial ?? fallback;
}
