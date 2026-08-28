import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FestivalLogo } from "@/components/FestivalLogo";
import { artistSlug, festivals, getFestival } from "@/data/festivals";

export const dynamicParams = false;
export function generateStaticParams() { return festivals.map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const festival = getFestival((await params).slug);
  return festival ? { title: festival.name, description: `${festival.name} 2027: dates, lineup, tickets, playlist and setlists.` } : {};
}

function prettyDate(value: string) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }

export default async function FestivalPage({ params }: { params: Promise<{ slug: string }> }) {
  const item = getFestival((await params).slug);
  if (!item) notFound();
  const setlistUrl = `https://www.setlist.fm/search?query=${encodeURIComponent(`festival:${item.name} date:2027`)}`;
  const tickets = item.ticketsUrl || item.officialUrl;
  return <div className="detailPage">
    <Link className="back" href="/">← All festivals</Link>
    <section className="detailHero"><FestivalLogo slug={item.slug} name={item.name} large/><div><div className="eyebrow">{item.countryCode} · {item.city || item.country}</div><h1>{item.name}</h1><p className="detailDate">{item.startDate ? `${prettyDate(item.startDate)}${item.endDate && item.endDate !== item.startDate ? ` — ${prettyDate(item.endDate)}` : ""}` : item.dateLabel}</p><span className={`status ${item.status}`}>{item.status === "tba" ? "Dates / lineup TBA" : `${item.status} lineup`}</span></div></section>
    <div className="actionGrid"><a href={item.officialUrl} target="_blank" rel="noreferrer"><small>Official</small><strong>Festival website ↗</strong></a><a href={tickets} target="_blank" rel="noreferrer"><small>Passes</small><strong>{item.ticketsUrl ? "Official tickets ↗" : "Tickets & info ↗"}</strong></a>{item.playlistUrl ? <a href={item.playlistUrl}><small>Listen</small><strong>Spotify playlist ↗</strong></a> : <div className="disabled"><small>Listen</small><strong>Playlist coming soon</strong></div>}<a href={setlistUrl} target="_blank" rel="noreferrer"><small>Live history</small><strong>setlist.fm ↗</strong></a></div>
    <section className="lineupSection"><div className="sectionHeading"><div><div className="eyebrow">DISCOVER THE BILL</div><h2>2027 lineup</h2></div><span>{item.headliners.length + item.lineup.length} announced</span></div>
      {item.headliners.length ? <><h3>Headliners & highlights</h3><div className="headlinerGrid">{item.headliners.map((artist) => <Link href={`/artists/${artistSlug(artist)}/`} key={artist}>{artist}<span>View artist →</span></Link>)}</div></> : <div className="lineupEmpty"><strong>No artists announced yet.</strong><span>We will update this page when the official festival publishes its first names.</span></div>}
      {item.lineup.length > 0 && <><h3>Also announced</h3><div className="lineupGrid">{item.lineup.map((artist) => <Link href={`/artists/${artistSlug(artist)}/`} key={artist}>{artist}</Link>)}</div></>}
    </section>
    <section className="sourceNote"><strong>Data transparency</strong><p>Seed data reviewed on 28 August 2026. Announcements can change; official festival information always takes priority.</p><a href={item.officialUrl}>Check primary source ↗</a></section>
  </div>;
}
