import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/ThemeProvider";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import type { Language } from "@/components/LanguageProvider";
import { LanguageProvider } from "@/components/LanguageProvider";
import { LocalPlannerProvider } from "@/components/LocalPlanner";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { PrivacyAnalytics } from "@/components/PrivacyAnalytics";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://loudweekend.eu"),
  title: { default: "Loud Weekend 2027", template: "%s · Loud Weekend" },
  description:
    "Europe's rock and metal festivals: dates, lineups, tickets, playlists and setlists.",
  manifest: "/manifest.webmanifest",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
  openGraph: {
    title: "Loud Weekend 2027",
    description: "European rock and metal festivals: dates, lineups, tickets, playlists and setlists.",
    type: "website",
  },
};

export const viewport: Viewport = { themeColor: "#171712" };

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const theme = (await cookies()).get("lw_theme")?.value === "dark" ? "dark" : "light";
  const requested = (await headers()).get("x-festival-locale");
  const language: Language = requested === "de" || requested === "ru" ? requested : "en";
  const skip = { en: "Skip to content", de: "Zum Inhalt springen", ru: "Перейти к содержимому" }[language];
  return (
    <html lang={language} data-theme={theme}>
      <body>
        <ThemeProvider initialTheme={theme}>
          <LanguageProvider initialLanguage={language}>
            <LocalPlannerProvider>
              <AppShell>{children}</AppShell>
              <ServiceWorkerRegistration />
              <PrivacyAnalytics />
            </LocalPlannerProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
