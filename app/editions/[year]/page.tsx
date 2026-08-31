import Link from "next/link";
import { notFound } from "next/navigation";
import { editionYears, getEditionsForYear } from "@/data/editions";

export function generateStaticParams() { return editionYears.map((year) => ({ year: String(year) })); }
export default async function EditionYearPage({ params }: { params: Promise<{ year: string }> }) {
  const year = Number((await params).year);
  const items = getEditionsForYear(year);
  if (!items.length) notFound();
  return <div className="directoryPage"><p className="eyebrow">EDITION YEAR</p><h1>{year} festival editions</h1><p>{items.length} provenance-aware {items.length === 1 ? "record" : "records"}. TBA means the official source has not yet published the field.</p><section>{items.map((item) => <article className="directoryRow" key={item.slug}><div><strong>{item.name}</strong><span>{item.startDate ? `${item.startDate} — ${item.endDate ?? item.startDate}` : "Dates TBA"} · {item.status === "tba" ? "Lineup TBA" : `${item.headliners.length + item.lineup.length} artists recorded`}</span></div><Link className="textLink" href={`/festivals/${item.slug}/${year}/`}>Open edition →</Link></article>)}</section><Link className="textLink" href="/archive/">← Archive and future tracking</Link></div>;
}
