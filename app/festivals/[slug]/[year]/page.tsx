import Link from "next/link";
import { notFound } from "next/navigation";
import { festivalEditions, getFestivalEdition } from "@/data/editions";

export function generateStaticParams() { return festivalEditions.map(({ slug, editionYear }) => ({ slug, year: String(editionYear) })); }
export default async function FestivalEditionPage({ params }: { params: Promise<{ slug: string; year: string }> }) {
  const { slug, year: rawYear } = await params;
  const item = getFestivalEdition(slug, Number(rawYear));
  if (!item) notFound();
  const artists = [...item.headliners, ...item.lineup];
  return <div className="detailPage"><Link className="back" href={`/editions/${item.editionYear}/`}>← {item.editionYear} editions</Link><section className="detailHero"><div><div className="eyebrow">{item.recordState.toUpperCase()} EDITION · {item.countryCode}</div><h1>{item.name} {item.editionYear}</h1><p className="detailDate">{item.startDate ? `${item.startDate} — ${item.endDate ?? item.startDate}` : "Dates TBA"}</p><span className={`status ${item.status}`}>{item.completeness === "tba" ? "Official dates and lineup TBA" : `${item.completeness} record`}</span></div></section><section className="lineupSection"><h2>Lineup status</h2>{artists.length ? <div className="lineupGrid">{artists.map((artist) => <span key={artist}>{artist}</span>)}</div> : <div className="lineupEmpty"><strong>No artists published</strong><span>This is an explicit tracking state, not an empty confirmed lineup.</span></div>}</section><section className="sourceNote"><strong>Provenance</strong>{item.snapshotAt && <p>Immutable snapshot captured {item.snapshotAt}.</p>}{item.provenance.map((source) => <p key={`${source.field}-${source.url}`}><b>{source.field}:</b> {source.note} <a href={source.url} target="_blank" rel="noreferrer">Official source ↗</a> <small>checked {source.checkedAt.slice(0, 10)}</small></p>)}</section></div>;
}
