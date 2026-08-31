import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { Language } from "@/components/LanguageProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LocalPlannerProvider } from "@/components/LocalPlanner";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { PrivacyAnalytics } from "@/components/PrivacyAnalytics";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://festivals.kir-it.de"),
  title: { default: "Festival Radar 2027", template: "%s · Festival Radar" },
  description:
    "Europe's rock and metal festivals: dates, lineups, tickets, playlists and setlists.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Festival Radar 2027",
    description: "50 European rock and metal festivals in one place.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#171712" };

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requested = (await headers()).get("x-festival-locale");
  const language: Language = requested === "de" || requested === "ru" ? requested : "en";
  const skip = { en: "Skip to content", de: "Zum Inhalt springen", ru: "Перейти к содержимому" }[language];
  return (
    <html lang={language}>
      <body>
        <a className="skipLink" href="#main-content">{skip}</a>
        <LanguageProvider initialLanguage={language}>
          <LocalPlannerProvider>
            <SiteHeader />
            <main id="main-content">{children}</main>
            <SiteFooter />
            <ServiceWorkerRegistration />
            <PrivacyAnalytics />
          </LocalPlannerProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
