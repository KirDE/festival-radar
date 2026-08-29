"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { lineupOverlap } from "@/lib/planning";
import { useLocalPlanner } from "./LocalPlanner";

function formatDates(item: Festival, locale: string, datesTba: string) {
  if (!item.startDate) return datesTba;
  const start = new Date(`${item.startDate}T12:00:00Z`);
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return `${start.getUTCDate()}${month.format(start) === month.format(end) ? "–" + end.getUTCDate() : " " + month.format(start) + " – " + end.getUTCDate()} ${month.format(end)}`;
}

export function FestivalExplorer({ festivals }: { festivals: Festival[] }) {
  const { locale, t } = useLanguage();
  const planner = useLocalPlanner();
  const [query, setQuery] = useState(planner.savedFilters.query);
  const [country, setCountry] = useState(planner.savedFilters.country);
  const [announcedOnly, setAnnouncedOnly] = useState(planner.savedFilters.announcedOnly);
  const [month, setMonth] = useState(planner.savedFilters.month);
  const [ticketsOnly, setTicketsOnly] = useState(planner.savedFilters.ticketsOnly);
  const [filtersReady, setFiltersReady] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const displayNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const countries = useMemo(() => Array.from(new Set(festivals.map((item) => item.countryCode))).sort((a, b) => (displayNames.of(a) || a).localeCompare(displayNames.of(b) || b, locale)), [festivals, displayNames, locale]);
  const visible = useMemo(() => festivals.filter((item) => {
    const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase()) && (country === "all" || item.countryCode === country) && (!announcedOnly || item.headliners.length > 0) && (month === "all" || item.startDate?.slice(5, 7) === month) && (!ticketsOnly || Boolean(item.ticketsUrl));
  }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999")), [festivals, query, country, announcedOnly, month, ticketsOnly]);
  const compared = festivals.filter((item) => selected.includes(item.slug));
  const overlap = lineupOverlap(compared);
  const toggleSelected = (slug: string) => setSelected((current) => current.includes(slug) ? current.filter((value) => value !== slug) : current.length < 3 ? [...current, slug] : current);
  useEffect(() => { if (planner.ready && !filtersReady) { setQuery(planner.savedFilters.query); setCountry(planner.savedFilters.country); setAnnouncedOnly(planner.savedFilters.announcedOnly); setMonth(planner.savedFilters.month); setTicketsOnly(planner.savedFilters.ticketsOnly); setFiltersReady(true); } }, [planner.ready, filtersReady]);
  useEffect(() => { if (filtersReady) planner.setSavedFilters({ query, country, announcedOnly, month, ticketsOnly }); }, [query, country, announcedOnly, month, ticketsOnly, filtersReady]);

  return <section className="explorer">
    <div className="filterBar">
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} /></label>
      <select aria-label={t("countries")} value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">{t("allCountries")}</option>{countries.map((value) => <option value={value} key={value}>{displayNames.of(value) || value}</option>)}</select>
      <select aria-label="Month" value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">All months</option>{[4,5,6,7,8,9].map((value) => <option key={value} value={String(value).padStart(2, "0")}>{new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2027, value - 1, 1)))}</option>)}</select>
      <label className="toggle"><input type="checkbox" checked={announcedOnly} onChange={(event) => setAnnouncedOnly(event.target.checked)} /><span/>{t("lineupAnnounced")}</label>
      <label className="toggle"><input type="checkbox" checked={ticketsOnly} onChange={(event) => setTicketsOnly(event.target.checked)} /><span/>Official tickets</label>
    </div>
    {compared.length > 0 && <div className="compareTray"><strong>Compare ({compared.length}/3)</strong>{compared.map((item) => <button onClick={() => toggleSelected(item.slug)} key={item.slug}>{item.name} ×</button>)}{compared.length > 1 && <span>{overlap.length ? `${overlap.length} shared acts: ${overlap.slice(0, 5).join(", ")}` : "No announced lineup overlap yet"}</span>}</div>}
    <div className="resultMeta"><span>{visible.length} {t("festivals")}</span><span>{t("lastReview")}</span></div>
    <div className="festivalGrid">{visible.map((item) => <article className="festivalCard" key={item.slug}><button className={`compareButton ${selected.includes(item.slug) ? "active" : ""}`} onClick={() => toggleSelected(item.slug)} disabled={!selected.includes(item.slug) && selected.length >= 3}>+ Compare</button><Link href={`/festivals/${item.slug}/`}>
      <div className="cardTop"><FestivalLogo slug={item.slug} name={item.name}/><span className={`status ${item.status}`}>{t(item.status === "tba" ? "tba" : item.status)}</span></div>
      <div className="date">{formatDates(item, locale, t("datesTba"))} · 2027</div>
      <h2>{item.name}</h2>
      <div className="location">{item.countryCode} · {item.city || displayNames.of(item.countryCode) || item.country}</div>
      <div className="artists">{item.headliners.length ? item.headliners.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>) : <span className="muted">{t("lineupNotAnnounced")}</span>}</div>
      <div className="cardFoot"><span>{item.headliners.length + item.lineup.length ? `${item.headliners.length + item.lineup.length} ${t("announcedActs")}` : t("followUpdates")}</span><b>{t("explore")} →</b></div>
    </Link></article>)}</div>
    {!visible.length && <div className="empty">{t("noMatches")}</div>}
  </section>;
}
