"use client";
import Link from "next/link";
import { useState } from "react";
import type { Festival } from "@/data/festivals";
import { useLocalPlanner, type Attendance } from "./LocalPlanner";
import { AccountSyncPanel } from "./AccountSyncPanel";
import { FestivalViews } from "./FestivalViews";
import { useLanguage, type Language } from "./LanguageProvider";

const plannerLabels: Record<Language, { eyebrow: string; title: string; intro: string; clear: string; calendar: string; saved: string; empty: string; emptyHelp: string; datesTba: string; noStatus: string; going: string; maybe: string; notGoing: string; download: string; selection: string; build: string; artists: string; favorites: string; attendance: string }> = {
  en: { eyebrow: "LOCAL TRIP PLANNER", title: "Your 2027 plan", intro: "Saved in this browser by default. Sign in below only if you want explicit cross-device sync.", clear: "Clear local data", calendar: "PERSONAL CALENDAR", saved: "saved festivals", empty: "No festivals saved yet.", emptyHelp: "Open a festival and choose Save, Going, or Maybe.", datesTba: "Dates TBA", noStatus: "No status", going: "Going", maybe: "Maybe", notGoing: "Not going", download: "Download calendar (.ics)", selection: "SELECTION PLAYLIST", build: "Build your lineup", artists: "artists", favorites: "FAVORITE ARTISTS", attendance: "Attendance for" },
  de: { eyebrow: "LOKALER REISEPLANER", title: "Dein Plan für 2027", intro: "Standardmäßig in diesem Browser gespeichert. Melde dich nur für eine geräteübergreifende Synchronisierung an.", clear: "Lokale Daten löschen", calendar: "PERSÖNLICHER KALENDER", saved: "gespeicherte Festivals", empty: "Noch keine Festivals gespeichert.", emptyHelp: "Öffne ein Festival und wähle Speichern, Dabei oder Vielleicht.", datesTba: "Termine offen", noStatus: "Kein Status", going: "Dabei", maybe: "Vielleicht", notGoing: "Nicht dabei", download: "Kalender herunterladen (.ics)", selection: "PLAYLIST-AUSWAHL", build: "Stelle dein Line-up zusammen", artists: "Künstler", favorites: "LIEBLINGSKÜNSTLER", attendance: "Teilnahme an" },
  ru: { eyebrow: "ЛОКАЛЬНЫЙ ПЛАН ПОЕЗДКИ", title: "Ваш план на 2027 год", intro: "По умолчанию данные сохраняются в этом браузере. Войдите только для синхронизации между устройствами.", clear: "Удалить локальные данные", calendar: "ЛИЧНЫЙ КАЛЕНДАРЬ", saved: "сохранённых фестивалей", empty: "Фестивали ещё не сохранены.", emptyHelp: "Откройте фестиваль и выберите «Сохранить», «Пойду» или «Возможно».", datesTba: "Даты уточняются", noStatus: "Без статуса", going: "Пойду", maybe: "Возможно", notGoing: "Не пойду", download: "Скачать календарь (.ics)", selection: "ПЛЕЙЛИСТ ПО ВЫБОРУ", build: "Соберите свой лайнап", artists: "артистов", favorites: "ЛЮБИМЫЕ АРТИСТЫ", attendance: "Посещение" },
};
export function PlannerPage({ festivals }: { festivals: Festival[] }) {
  const { language } = useLanguage();
  const t = plannerLabels[language];
  const p = useLocalPlanner();
  const [playlist, setPlaylist] = useState<{ status: "idle" | "creating" | "created" | "error"; message?: string; url?: string }>({ status: "idle" });
  const planned = festivals.filter(
    (f) => p.favoriteFestivals.includes(f.slug) || p.attendance[f.slug],
  );
  const selected = festivals.filter((f) =>
    p.playlistFestivals.includes(f.slug),
  );
  const artists = Array.from(
    new Set(selected.flatMap((f) => [...f.headliners, ...f.lineup])),
  ).sort();
  const dated = planned
    .filter((f) => f.startDate)
    .sort((a, b) => a.startDate!.localeCompare(b.startDate!));
  async function createPlaylist() {
    setPlaylist({ status: "creating", message: "Creating your private Spotify playlist…" });
    try {
      const response = await fetch("/api/spotify/selection-playlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ artists, festivals: selected.map((festival) => festival.name) }) });
      const result = await response.json() as { error?: string; playlistUrl?: string; trackCount?: number; unresolved?: string[] };
      if (!response.ok || !result.playlistUrl) throw new Error(result.error || "Playlist creation failed.");
      setPlaylist({ status: "created", url: result.playlistUrl, message: `Created with ${result.trackCount} tracks${result.unresolved?.length ? `; ${result.unresolved.length} artists could not be matched` : ""}.` });
    } catch (cause) {
      setPlaylist({ status: "error", message: cause instanceof Error ? cause.message : "Playlist creation failed." });
    }
  }
  return (
    <div className="plannerPage">
      <FestivalViews festivals={festivals} />
      <div className="plannerHero">
        <div>
          <div className="eyebrow">{t.eyebrow}</div>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <button className="outlineButton" onClick={p.clear}>
          {t.clear}
        </button>
      </div>
      {p.ready && (
        <>
          <AccountSyncPanel />
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">{t.calendar}</div>
                <h2>{planned.length} {t.saved}</h2>
              </div>
            </div>
            {!planned.length && (
              <div className="lineupEmpty">
                <strong>{t.empty}</strong>
                <span>{t.emptyHelp}</span>
              </div>
            )}
            <div className="planList">
              {planned.map((f) => (
                <article key={f.slug}>
                  <div>
                    <small>{f.startDate || t.datesTba}</small>
                    <Link href={`/festivals/${f.slug}/`}>
                      <strong>{f.name}</strong>
                    </Link>
                    <span>
                      {f.city} · {f.countryCode}
                    </span>
                  </div>
                  <select
                    value={p.attendance[f.slug] || ""}
                    aria-label={`${t.attendance} ${f.name}`}
                    onChange={(e) =>
                      p.setAttendance(
                        f.slug,
                        (e.target.value || undefined) as Attendance | undefined,
                      )
                    }
                  >
                    <option value="">{t.noStatus}</option>
                    <option value="going">{t.going}</option>
                    <option value="maybe">{t.maybe}</option>
                    <option value="not-going">{t.notGoing}</option>
                  </select>
                </article>
              ))}
            </div>
            {!!dated.length && (
              <a
                className="primaryButton"
                href={`data:text/calendar;charset=utf-8,${encodeURIComponent(calendarFile(dated))}`}
                download="festival-radar-2027.ics"
              >
                {t.download}
              </a>
            )}
          </section>
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">{t.selection}</div>
                <h2>{t.build}</h2>
              </div>
              <span>{artists.length} {t.artists}</span>
            </div>
            <div className="playlistFestivalGrid">
              {festivals.map((f) => (
                <label key={f.slug}>
                  <input
                    type="checkbox"
                    checked={p.playlistFestivals.includes(f.slug)}
                    onChange={() => p.togglePlaylistFestival(f.slug)}
                  />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
            {!!artists.length && (
              <div>
                <div className="playlistActions">
                  <button className="primaryButton" type="button" disabled={playlist.status === "creating"} onClick={createPlaylist}>
                    {playlist.status === "creating" ? "Creating…" : "Create private Spotify playlist"}
                  </button>
                  <a className="outlineButton" href="/api/spotify/connect">Connect Spotify</a>
                </div>
                <p className={`playlistStatus ${playlist.status}`} role="status">
                  {playlist.message || "Creates one private playlist with one representative track per deduplicated artist."}
                  {playlist.url && <> <a href={playlist.url} target="_blank" rel="noreferrer">Open playlist ↗</a></>}
                </p>
                <details>
                  <summary>Fallback: export deduplicated artist list</summary>
                  <p>If sign-in, Spotify credentials, or matching is unavailable, download this saved selection and import it with a playlist transfer tool that supports newline-separated artists.</p>
                <a
                  className="outlineButton"
                  href={`data:text/plain;charset=utf-8,${encodeURIComponent(artists.join("\n"))}`}
                  download="festival-radar-playlist-artists.txt"
                >
                  Download artist list
                </a>
                </details>
              </div>
            )}
          </section>
          {!!p.favoriteArtists.length && (
            <section className="plannerSection">
              <div className="eyebrow">{t.favorites}</div>
              <div className="artistChips">
                {p.favoriteArtists.map((a) => (
                  <span key={a}>{a}</span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function calendarFile(items: Festival[]) {
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Festival Radar//Trip Planner//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const f of items) {
    const end = new Date(`${f.endDate || f.startDate}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    out.push(
      "BEGIN:VEVENT",
      `UID:${f.slug}-2027@festival-radar`,
      `DTSTART;VALUE=DATE:${f.startDate!.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replaceAll("-", "")}`,
      `SUMMARY:${f.name}`,
      `LOCATION:${f.city || f.country}`,
      `URL:${f.officialUrl}`,
      "END:VEVENT",
    );
  }
  return [...out, "END:VCALENDAR"].join("\r\n");
}
