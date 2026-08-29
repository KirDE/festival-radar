"use client";

import Link from "next/link";
import { useLanguage, type Language } from "./LanguageProvider";

export function SiteHeader() {
  const { t } = useLanguage();
  return (
    <header className="siteHeader">
      <Link className="brand" href="/">
        <span className="brandMark">FR</span>
        <span>Festival Radar</span>
      </Link>
      <nav>
        <Link href="/">{t("festivals")}</Link>
        <Link href="/planner/">My plan</Link>
        <a href="https://github.com/KirDE/festival-radar">{t("aboutData")}</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <footer>
      <span>Festival Radar · Europe 2027</span>
      <span>{t("footerNote")}</span>
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
    </footer>
  );
}
