"use client";

import { usePathname } from "next/navigation";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import { useLanguage } from "./LanguageProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t, ta } = useLanguage();
  const admin = pathname.startsWith("/admin");

  return <>
    <a className="skipLink" href="#main-content">{admin ? ta("skip") : t("skip")}</a>
    {!admin && <SiteHeader />}
    <main id="main-content" className={admin ? "adminPage" : undefined}>{children}</main>
    {!admin && <SiteFooter />}
  </>;
}
