import Link from "next/link";
import { archivedEditions, trackedFutureEditions } from "@/data/editions";

export const metadata = { title: "Festival archives and future editions", description: "Browse provenance-aware Festival Radar editions.", alternates: { canonical: "/archive/" } };

function EditionRow({ item }: { item: (typeof archivedEditions)[number] | (typeof trackedFutureEditions)[number] }) {
  const artists = item.headliners.length + item.lineup.length;
  return <article className="directoryRow"><div><strong>{item.name} {item.editionYear}</strong><span>{item.startDate ? `${item.startDate} — ${item.endDate ?? item.startDate}` : "Dates TBA"} · {artists ? `${artists} archived artists (partial snapshot)` : "Lineup TBA"}</span></div><Link className="textLink" href={`/festivals/${item.slug}/${item.editionYear}/`}>Open edition →</Link></article>;
}

export default function ArchivePage() { return <div className="directoryPage"><p className="eyebrow">FESTIVAL EDITIONS</p><h1>Archived and future records</h1><p>Every row is an edition record with explicit source evidence. Archived snapshots are immutable; tracking records remain visibly TBA until an official announcement exists.</p><section><h2>Archived editions</h2>{archivedEditions.map((item) => <EditionRow item={item} key={`${item.slug}-${item.editionYear}`} />)}</section><section><h2>Future tracking</h2>{trackedFutureEditions.map((item) => <EditionRow item={item} key={`${item.slug}-${item.editionYear}`} />)}</section><Link className="textLink" href="/editions/2027/">Browse the current 2027 season →</Link></div>; }
