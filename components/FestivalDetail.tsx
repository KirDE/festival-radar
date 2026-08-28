"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import { artistSlug, festivals } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { PlanningTools } from "./PlanningTools";

export function FestivalDetail({ item }: { item: Festival }) {
  const { locale, t } = useLanguage();
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const prettyDate = (value: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const setlistUrl = `https://www.setlist.fm/search?query=${encodeURIComponent(`festival:${item.name} date:2027`)}`;
  const tickets = item.ticketsUrl || item.officialUrl;
  const status = item.status === "tba" ? t("datesLineupTba") : t(item.status === "confirmed" ? "confirmedLineup" : "partialLineup");
  return <div className="detailPage"><Link className="back" href="/">← {t("allFestivals")}</Link><section className="detailHero"><FestivalLogo slug={item.slug} name={item.name} large/><div><div className="eyebrow">{item.countryCode} · {item.city || displayNames.of(item.countryCode) || item.country}</div><h1>{item.name}</h1><p className="detailDate">{item.startDate ? `${prettyDate(item.startDate)}${item.endDate && item.endDate !== item.startDate ? ` — ${prettyDate(item.endDate)}` : ""}` : t("datesTba")}</p><span className={`status ${item.status}`}>{status}</span></div></section>
    <div className="actionGrid"><a href={item.officialUrl} target="_blank" rel="noreferrer"><small>{t("official")}</small><strong>{t("festivalWebsite")}</strong></a><a href={tickets} target="_blank" rel="noreferrer"><small>{t("passes")}</small><strong>{t(item.ticketsUrl ? "officialTickets" : "ticketsInfo")}</strong></a>{item.playlistUrl ? <a href={item.playlistUrl} target="_blank" rel="noreferrer"><small>{t("listen")}</small><strong>{t("spotifyPlaylist")}</strong></a> : <div className="disabled"><small>{t("listen")}</small><strong>{t("playlistSoon")}</strong></div>}<a href={setlistUrl} target="_blank" rel="noreferrer"><small>{t("liveHistory")}</small><strong>setlist.fm ↗</strong></a></div>
    <section className="lineupSection"><div className="sectionHeading"><div><div className="eyebrow">{t("discoverBill")}</div><h2>{t("lineup2027")}</h2></div><span>{item.headliners.length + item.lineup.length} {t("announced")}</span></div>
      {item.headliners.length ? <><h3>{t("headliners")}</h3><div className="headlinerGrid">{item.headliners.map((artist) => <Link href={`/artists/${artistSlug(artist)}/`} key={artist}>{artist}<span>{t("viewArtist")}</span></Link>)}</div></> : <div className="lineupEmpty"><strong>{t("noArtists")}</strong><span>{t("noArtistsText")}</span></div>}
      {item.lineup.length > 0 && <><h3>{t("alsoAnnounced")}</h3><div className="lineupGrid">{item.lineup.map((artist) => <Link href={`/artists/${artistSlug(artist)}/`} key={artist}>{artist}</Link>)}</div></>}
    </section><PlanningTools item={item} festivals={festivals}/><section className="sourceNote"><strong>{t("transparency")}</strong><p>{t("sourceText")}</p><a href={item.officialUrl} target="_blank" rel="noreferrer">{t("primarySource")}</a></section></div>;
}
