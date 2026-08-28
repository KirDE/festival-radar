"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";

function formatDates(item: Festival) {
  if (!item.startDate) return item.dateLabel || "Dates TBA";
  const start = new Date(`${item.startDate}T12:00:00Z`);
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" });
  return `${start.getUTCDate()}${month.format(start) === month.format(end) ? "–" + end.getUTCDate() : " " + month.format(start) + " – " + end.getUTCDate()} ${month.format(end)}`;
}

export function FestivalExplorer({ festivals }: { festivals: Festival[] }) {
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("all");
  const [announcedOnly, setAnnouncedOnly] = useState(false);
  const countries = Array.from(new Set(festivals.map((item) => item.country))).sort();
  const visible = useMemo(() => festivals.filter((item) => {
    const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase()) && (country === "all" || item.country === country) && (!announcedOnly || item.headliners.length > 0);
  }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999")), [festivals, query, country, announcedOnly]);

  return <section className="explorer">
    <div className="filterBar">
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Festival, artist or city" /></label>
      <select aria-label="Country" value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">All countries</option>{countries.map((value) => <option key={value}>{value}</option>)}</select>
      <label className="toggle"><input type="checkbox" checked={announcedOnly} onChange={(event) => setAnnouncedOnly(event.target.checked)} /><span/>Lineup announced</label>
    </div>
    <div className="resultMeta"><span>{visible.length} festivals</span><span>Last dataset review · 28 Aug 2026</span></div>
    <div className="festivalGrid">{visible.map((item) => <Link className="festivalCard" href={`/festivals/${item.slug}/`} key={item.slug}>
      <div className="cardTop"><FestivalLogo slug={item.slug} name={item.name}/><span className={`status ${item.status}`}>{item.status === "tba" ? "TBA" : item.status}</span></div>
      <div className="date">{formatDates(item)} · 2027</div>
      <h2>{item.name}</h2>
      <div className="location">{item.countryCode} · {item.city || item.country}</div>
      <div className="artists">{item.headliners.length ? item.headliners.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>) : <span className="muted">Lineup not announced</span>}</div>
      <div className="cardFoot"><span>{item.headliners.length + item.lineup.length ? `${item.headliners.length + item.lineup.length} announced acts` : "Follow for updates"}</span><b>Explore →</b></div>
    </Link>)}</div>
    {!visible.length && <div className="empty">No matching festivals. Try a different artist or country.</div>}
  </section>;
}
