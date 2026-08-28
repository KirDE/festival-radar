import type { Metadata } from "next";
import { LanguageProvider } from "@/components/LanguageProvider";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://festivals.kir-it.de"),
  title: { default: "Festival Radar 2027", template: "%s · Festival Radar" },
  description: "Europe's rock and metal festivals: dates, lineups, tickets, playlists and setlists.",
  openGraph: { title: "Festival Radar 2027", description: "50 European rock and metal festivals in one place.", type: "website" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <LanguageProvider>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </LanguageProvider>
      </body>
    </html>
  );
}
