"use client";

import Link from "next/link";
import { useLanguage, type Language } from "./LanguageProvider";
import { AccountMenu } from "./AccountMenu";

export function SiteHeader() {
  const { language, t } = useLanguage();
  return (
    <header className="siteHeader">
      <Link className="brand" href={`/${language}/`}>
        <span className="brandMark">FR</span>
        <span>Festival Radar</span>
      </Link>
      <nav>
        <Link href={`/${language}/`}>{t("festivals")}</Link>
        <Link href={`/${language}/planner/`}>{t("myPlan")}</Link>
        <Link href="/notifications/">{t("notifications")}</Link>
        <a href="https://github.com/KirDE/festival-radar">{t("aboutData")}</a>
      </nav>
      <AccountMenu />
    </header>
  );
}

export function SiteFooter() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <footer>
      <span>Festival Radar · Europe 2027</span>
      <span>{t("footerNote")} · {t("privacy")}</span>
      <Link href={`/${language}/submit/`}>{t("submitFestival")}</Link>
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
