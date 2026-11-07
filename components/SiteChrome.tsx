"use client";

import Link from "next/link";
import { useLanguage, type Language } from "./LanguageProvider";
import { useTheme } from "./ThemeProvider";
import { AccountMenu } from "./AccountMenu";

export function SiteHeader() {
  const { t } = useLanguage();
  return (
    <header className="siteHeader">
      <Link className="brand" href="/">
        <span className="brandMark">LW</span>
        <span>Loud Weekend</span>
      </Link>
      <nav>
        <Link href="/">{t("festivals")}</Link>
        <Link href="/planner/">{t("myPlan")}</Link>
        <Link href="/notifications/">{t("notifications")}</Link>
        <a href="https://github.com/KirDE/loud-weekend">{t("aboutData")}</a>
      </nav>
      <AccountMenu />
    </header>
  );
}

export function SiteFooter() {
  const { language, setLanguage, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const themeLabel = { en: "Dark mode", de: "Dunkelmodus", ru: "Тёмная тема" }[language];
  return (
    <footer className="siteFooter">
      <span>Loud Weekend · {t("region")}</span>
      <span>{t("footerNote")} · {t("privacy")}</span>
      <Link href="/submit/">{t("submitFestival")}</Link>
      <div className="footerPreferences">
        <label className="languagePicker">
          <span>{t("language")}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
            aria-label={t("language")}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <button type="button" className="themeToggle" role="switch" aria-checked={theme === "dark"} onClick={toggleTheme}>
          <span aria-hidden="true">{theme === "dark" ? "☾" : "☀"}</span> {themeLabel}
        </button>
      </div>
    </footer>
  );
}
