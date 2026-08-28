"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Festival } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";

function formatDates(item: Festival, locale: string, datesTba: string) {
  if (!item.startDate) return datesTba;
  const start = new Date(`${item.startDate}T12:00:00Z`);
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return `${start.getUTCDate()}${month.format(start) === month.format(end) ? "–" + end.getUTCDate() : " " + month.format(start) + " – " + end.getUTCDate()} ${month.format(end)}`;
}

export function FestivalExplorer({ festivals }: { festivals: Festival[] }) {
  const { locale, t } = useLanguage();
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("all");
  const [announcedOnly, setAnnouncedOnly] = useState(false);
  const displayNames = useMemo(() => new Intl.DisplayNames([locale], { type: "region" }), [locale]);
  const countries = useMemo(() => Array.from(new Set(festivals.map((item) => item.countryCode))).sort((a, b) => (displayNames.of(a) || a).localeCompare(displayNames.of(b) || b, locale)), [festivals, displayNames, locale]);
  const visible = useMemo(() => festivals.filter((item) => {
    const haystack = [item.name, item.country, item.city, ...item.headliners, ...item.lineup].join(" ").toLowerCase();
    return haystack.includes(query.toLowerCase()) && (country === "all" || item.countryCode === country) && (!announcedOnly || item.headliners.length > 0);
  }).sort((a, b) => (a.startDate || "9999").localeCompare(b.startDate || "9999")), [festivals, query, country, announcedOnly]);

  return <section className="explorer">
    <div className="filterBar">
      <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search")} /></label>
      <select aria-label={t("countries")} value={country} onChange={(event) => setCountry(event.target.value)}><option value="all">{t("allCountries")}</option>{countries.map((value) => <option value={value} key={value}>{displayNames.of(value) || value}</option>)}</select>
      <label className="toggle"><input type="checkbox" checked={announcedOnly} onChange={(event) => setAnnouncedOnly(event.target.checked)} /><span/>{t("lineupAnnounced")}</label>
    </div>
    <div className="resultMeta"><span>{visible.length} {t("festivals")}</span><span>{t("lastReview")}</span></div>
    <div className="festivalGrid">{visible.map((item) => <Link className="festivalCard" href={`/festivals/${item.slug}/`} key={item.slug}>
      <div className="cardTop"><FestivalLogo slug={item.slug} name={item.name}/><span className={`status ${item.status}`}>{t(item.status === "tba" ? "tba" : item.status)}</span></div>
      <div className="date">{formatDates(item, locale, t("datesTba"))} · 2027</div>
      <h2>{item.name}</h2>
      <div className="location">{item.countryCode} · {item.city || displayNames.of(item.countryCode) || item.country}</div>
      <div className="artists">{item.headliners.length ? item.headliners.slice(0, 4).map((artist) => <span key={artist}>{artist}</span>) : <span className="muted">{t("lineupNotAnnounced")}</span>}</div>
      <div className="cardFoot"><span>{item.headliners.length + item.lineup.length ? `${item.headliners.length + item.lineup.length} ${t("announcedActs")}` : t("followUpdates")}</span><b>{t("explore")} →</b></div>
    </Link>)}</div>
    {!visible.length && <div className="empty">{t("noMatches")}</div>}
  </section>;
}
