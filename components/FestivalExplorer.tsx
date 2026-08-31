"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { lineupOverlap } from "@/lib/planning";
import { useLocalPlanner } from "./LocalPlanner";
import { hasAvailableTickets } from "@/lib/tickets";
import { distanceKm, festivalGenres, festivalMatchesDiscoveryFilters, type Coordinates } from "@/lib/festival-discovery";

const origins: Record<string, { label: string; coordinates: Coordinates }> = {
  berlin: { label: "Berlin, Germany", coordinates: { latitude: 52.5200, longitude: 13.4050 } },
  cologne: { label: "Cologne, Germany", coordinates: { latitude: 50.9375, longitude: 6.9603 } },
  amsterdam: { label: "Amsterdam, Netherlands", coordinates: { latitude: 52.3676, longitude: 4.9041 } },
  london: { label: "London, United Kingdom", coordinates: { latitude: 51.5072, longitude: -0.1276 } },
  prague: { label: "Prague, Czechia", coordinates: { latitude: 50.0755, longitude: 14.4378 } },
};

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
  const [genre, setGenre] = useState("all");
  const [origin, setOrigin] = useState("berlin");
  const [maxDistance, setMaxDistance] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparisonStatus, setComparisonStatus] = useState("");
  const displayNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const countries = useMemo(() => Array.from(new Set(festivals.map((item) => item.countryCode))).sort((a, b) => (displayNames.of(a) || a).localeCompare(displayNames.of(b) || b, locale)), [festivals, displayNames, locale]);
  const genres = useMemo(() => festivalGenres(festivals), [festivals]);
  const originCoordinates = origins[origin]?.coordinates;
  const visible = useMemo(() => festivals.filter((item) => {
    const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase()) && (country === "all" || item.countryCode === country) && (!announcedOnly || item.headliners.length > 0) && (month === "all" || item.startDate?.slice(5, 7) === month) && (!ticketsOnly || hasAvailableTickets(item)) && festivalMatchesDiscoveryFilters(item, { genre: genre === "all" ? undefined : genre, origin: originCoordinates, maxDistanceKm: maxDistance === "all" ? undefined : Number(maxDistance) });
  }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999")), [festivals, query, country, announcedOnly, month, ticketsOnly, genre, originCoordinates, maxDistance]);
  const compared = festivals.filter((item) => selected.includes(item.slug));
  const overlap = lineupOverlap(compared);
  const toggleSelected = (item: Festival) => setSelected((current) => {
    if (current.includes(item.slug)) {
      const next = current.filter((value) => value !== item.slug);
      setComparisonStatus(t("comparisonRemoved", { festival: item.name, count: next.length }));
      return next;
    }
    if (current.length >= 3) {
      setComparisonStatus(t("comparisonLimit", { festival: item.name }));
      return current;
    }
    const next = [...current, item.slug];
    setComparisonStatus(t("comparisonSelected", { festival: item.name, count: next.length }));
    return next;
  });
  useEffect(() => { if (planner.ready && !filtersReady) { setQuery(planner.savedFilters.query); setCountry(planner.savedFilters.country); setAnnouncedOnly(planner.savedFilters.announcedOnly); setMonth(planner.savedFilters.month); setTicketsOnly(planner.savedFilters.ticketsOnly); setFiltersReady(true); } }, [planner.ready, filtersReady]);
  useEffect(() => { if (filtersReady) planner.setSavedFilters({ query, country, announcedOnly, month, ticketsOnly }); }, [query, country, announcedOnly, month, ticketsOnly, filtersReady]);

  return <section className="explorer">
    <div className="filterBar">
      <label className="search"><span aria-hidden="true">⌕</span><input aria-label={t("filterSearch")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} /></label>
      <select aria-label={t("countries")} value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">{t("allCountries")}</option>{countries.map((value) => <option value={value} key={value}>{displayNames.of(value) || value}</option>)}</select>
      <select aria-label={t("filterMonth")} value={month} onChange={(event) => setMonth(event.target.value)}><option value="all">{t("allMonths")}</option>{[4,5,6,7,8,9].map((value) => <option key={value} value={String(value).padStart(2, "0")}>{new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2027, value - 1, 1)))}</option>)}</select>
      <select aria-label={t("filterGenre")} value={genre} onChange={(event) => setGenre(event.target.value)}><option value="all">{t("allGenres")}</option>{genres.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      <select aria-label={t("filterOrigin")} value={origin} onChange={(event) => setOrigin(event.target.value)}>{Object.entries(origins).map(([value, item]) => <option key={value} value={value}>{t("fromOrigin", { origin: item.label })}</option>)}</select>
      <select aria-label={t("filterDistance")} value={maxDistance} onChange={(event) => setMaxDistance(event.target.value)}><option value="all">{t("anyDistance")}</option>{[100, 250, 500, 1000, 2000].map((value) => <option key={value} value={value}>{t("withinDistance", { distance: value.toLocaleString(locale) })}</option>)}</select>
      <label className="toggle"><input type="checkbox" checked={announcedOnly} onChange={(event) => setAnnouncedOnly(event.target.checked)} /><span/>{t("lineupAnnounced")}</label>
      <label className="toggle"><input type="checkbox" checked={ticketsOnly} onChange={(event) => setTicketsOnly(event.target.checked)} /><span aria-hidden="true"/>{t("officialTicketsOnly")}</label>
    </div>
    <p className="srOnly" role="status" aria-live="polite" aria-atomic="true">{comparisonStatus}</p>
    {compared.length > 0 && <div className="compareTray"><div className="compareHeading"><strong>{t("compare")} ({compared.length}/3)</strong>{compared.map((item) => <button aria-label={t("removeFestivalComparison", { festival: item.name })} onClick={() => toggleSelected(item)} key={item.slug}>{item.name} <span aria-hidden="true">×</span></button>)}</div>{compared.length < 2 ? <p className="compareHint">{t("comparisonInstructions")}</p> : <div className="comparisonScroll" tabIndex={0}><table className="comparisonTable"><thead><tr><th scope="col">{t("planningDetail")}</th>{compared.map((item) => <th scope="col" key={item.slug}><Link href={`/festivals/${item.slug}/`}>{item.name}</Link></th>)}</tr></thead><tbody><tr><th scope="row">{t("dates")}</th>{compared.map((item) => <td key={item.slug}>{formatDates(item, locale, t("datesTba"))} · 2027</td>)}</tr><tr><th scope="row">{t("locationDistance", { origin: origins[origin].label })}</th>{compared.map((item) => <td key={item.slug}>{item.city || item.country}{item.coordinates ? ` · ${distanceKm(originCoordinates, item.coordinates).toLocaleString(locale)} km` : ` · ${t("distanceUnavailable")}`}</td>)}</tr><tr><th scope="row">{t("tickets")}</th>{compared.map((item) => <td key={item.slug}>{item.ticketsUrl ? <a href={item.ticketsUrl} rel="noreferrer" target="_blank">{t("officialTickets")}</a> : item.ticketStatus === "unavailable" ? t("unavailable") : t("availabilityNotConfirmed")}</td>)}</tr><tr><th scope="row">{t("lineupOverlap")}</th><td colSpan={compared.length}>{overlap.length ? <><strong>{t("sharedActs", { count: overlap.length })}</strong><br/>{overlap.join(", ")}</> : t("noLineupOverlap")}</td></tr></tbody></table></div>}</div>}
    <div className="resultMeta"><span>{visible.length} {t("festivals")}</span><span>{t("lastReview")}</span></div>
    <div className="festivalGrid">{visible.map((item) => { const isSelected = selected.includes(item.slug); return <article className="festivalCard" key={item.slug}><button type="button" className={`compareButton ${isSelected ? "active" : ""}`} aria-pressed={isSelected} aria-label={t("compareFestival", { festival: item.name })} onClick={() => toggleSelected(item)} disabled={!isSelected && selected.length >= 3}><span aria-hidden="true">{isSelected ? "✓ " : "+ "}</span>{t("compare")}</button><Link href={`/festivals/${item.slug}/`}>
      <div className="cardTop"><FestivalLogo slug={item.slug} name={item.name}/><span className={`status ${item.status}`}>{t(item.status === "tba" ? "tba" : item.status)}</span></div>
      <div className="date">{formatDates(item, locale, t("datesTba"))} · 2027</div>
      <h2>{item.name}</h2>
      <div className="location">{item.countryCode} · {item.city || displayNames.of(item.countryCode) || item.country}</div>
      <div className="artists">{item.headliners.length ? item.headliners.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>) : <span className="muted">{t("lineupNotAnnounced")}</span>}</div>
      <div className="cardFoot"><span>{item.headliners.length + item.lineup.length ? `${item.headliners.length + item.lineup.length} ${t("announcedActs")}` : t("followUpdates")}</span><b>{t("explore")} →</b></div>
    </Link></article>; })}</div>
    {!visible.length && <div className="empty"><strong>{t("noMatches")}</strong><p>{t("noDiscoveryMatches")}</p></div>}
  </section>;
}
