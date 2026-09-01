"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import { artistSlug, festivals } from "@/data/festivals";
import { FestivalLogo } from "./FestivalLogo";
import { useLanguage } from "./LanguageProvider";
import { PlanningTools } from "./PlanningTools";
import playlistStatus from "@/data/playlist-status.json";
import type { PlaylistStatus } from "@/data/festivals";
import { ticketPresentation } from "@/lib/tickets";
import {
  FavoriteButton,
  useLocalPlanner,
  type Attendance,
} from "./LocalPlanner";

export function FestivalDetail({ item }: { item: Festival }) {
  const { language, locale, t } = useLanguage();
  const planner = useLocalPlanner();
  const displayNames = new Intl.DisplayNames([locale], { type: "region" });
  const prettyDate = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const setlistUrl = `https://www.setlist.fm/search?query=${encodeURIComponent(`festival:${item.name} date:2027`)}`;
  const tickets = ticketPresentation(item);
  const status =
    item.status === "tba"
      ? t("datesLineupTba")
      : t(item.status === "confirmed" ? "confirmedLineup" : "partialLineup");
  const playlist = (playlistStatus as Record<string, PlaylistStatus>)[
    item.slug
  ];
  const playlistUrl = playlist?.spotifyUrl || item.playlistUrl;
  return (
    <div className="detailPage">
      <Link className="back" href={`/${language}/`}>
        ← {t("allFestivals")}
      </Link>
      <section className="detailHero">
        <FestivalLogo slug={item.slug} name={item.name} large />
        <div>
          <div className="eyebrow">
            {item.countryCode} ·{" "}
            {item.city || displayNames.of(item.countryCode) || item.country}
          </div>
          <h1>{item.name}</h1>
          <p className="detailDate">
            {item.startDate
              ? `${prettyDate(item.startDate)}${item.endDate && item.endDate !== item.startDate ? ` — ${prettyDate(item.endDate)}` : ""}`
              : t("datesTba")}
          </p>
          <span className={`status ${item.status}`}>{status}</span>
        </div>
      </section>
      <section className="localActions">
        <FavoriteButton kind="festival" value={item.slug} />
        <select
          aria-label={`Attendance for ${item.name}`}
          value={planner.attendance[item.slug] || ""}
          onChange={(event) =>
            planner.setAttendance(
              item.slug,
              (event.target.value || undefined) as Attendance | undefined,
            )
          }
        >
          <option value="">Set attendance</option>
          <option value="going">Going</option>
          <option value="maybe">Maybe</option>
          <option value="not-going">Not going</option>
        </select>
        <Link href={`/${language}/planner/`}>Open my plan →</Link>
      </section>
      <div className="actionGrid">
        <a href={item.officialUrl} target="_blank" rel="noreferrer">
          <small>{t("official")}</small>
          <strong>{t("festivalWebsite")}</strong>
        </a>
        {tickets.status === "available" ? (
          <a href={tickets.href} target="_blank" rel="noreferrer">
            <small>{t("passes")}</small>
            <strong>{t(tickets.label)}</strong>
          </a>
        ) : (
          <div className="disabled" data-ticket-status={tickets.status}>
            <small>{t("passes")}</small>
            <strong>{t(tickets.label)}</strong>
          </div>
        )}
        {playlistUrl ? (
          <a href={playlistUrl} target="_blank" rel="noreferrer">
            <small>
              {t("listen")}
              {playlist
                ? ` · ${playlist.artists} ${t("artists")} · ${playlist.tracks} ${t("tracks")}`
                : ""}
            </small>
            <strong>{t("spotifyPlaylist")}</strong>
          </a>
        ) : (
          <div className="disabled">
            <small>{t("listen")}</small>
            <strong>{t("playlistSoon")}</strong>
          </div>
        )}
        {playlist?.youtubeMusicUrl ? (
          <a href={playlist.youtubeMusicUrl} target="_blank" rel="noreferrer">
            <small>{t("listen")} · {playlist.artists} {t("artists")} · {playlist.tracks} {t("tracks")}</small>
            <strong>{t("youtubeMusicPlaylist")}</strong>
          </a>
        ) : null}
        <a href={setlistUrl} target="_blank" rel="noreferrer">
          <small>{t("liveHistory")}</small>
          <strong>setlist.fm ↗</strong>
        </a>
      </div>
      <section className="lineupSection">
        <div className="sectionHeading">
          <div>
            <div className="eyebrow">{t("discoverBill")}</div>
            <h2>{t("lineup2027")}</h2>
          </div>
          <span>
            {item.headliners.length + item.lineup.length} {t("announced")}
          </span>
        </div>
        {item.headliners.length ? (
          <>
            <h3>{t("headliners")}</h3>
            <div className="headlinerGrid">
              {item.headliners.map((artist) => (
                <Link href={`/${language}/artists/${artistSlug(artist)}/`} key={artist}>
                  {artist}
                  <span>{t("viewArtist")}</span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="lineupEmpty">
            <strong>{t("noArtists")}</strong>
            <span>{t("noArtistsText")}</span>
          </div>
        )}
        {item.lineup.length > 0 && (
          <>
            <h3>{t("alsoAnnounced")}</h3>
            <div className="lineupGrid">
              {item.lineup.map((artist) => (
                <Link href={`/${language}/artists/${artistSlug(artist)}/`} key={artist}>
                  {artist}
                </Link>
              ))}
            </div>
          </>
        )}
      </section>
      <PlanningTools item={item} festivals={festivals} />
      <section className="sourceNote">
        <strong>{t("transparency")}</strong>
        <p>{t("sourceText")}</p>
        <a href={item.officialUrl} target="_blank" rel="noreferrer">
          {t("primarySource")}
        </a>
      </section>
    </div>
  );
}
