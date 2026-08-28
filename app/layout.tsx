import type { Metadata } from "next";
import Link from "next/link";
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
        <header className="siteHeader">
          <Link className="brand" href="/"><span className="brandMark">FR</span><span>Festival Radar</span></Link>
          <nav><Link href="/">Festivals</Link><a href="https://github.com/KirDE/festival-radar">About data</a></nav>
        </header>
        <main>{children}</main>
        <footer><span>Festival Radar · Europe 2027</span><span>Always confirm dates and tickets with the official festival.</span></footer>
      </body>
    </html>
  );
}
