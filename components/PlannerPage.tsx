"use client";
import Link from "next/link";
import { useState } from "react";
import type { Festival } from "@/data/festivals";
import { useLocalPlanner, type Attendance } from "./LocalPlanner";
export function PlannerPage({ festivals }: { festivals: Festival[] }) {
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
      <div className="plannerHero">
        <div>
          <div className="eyebrow">LOCAL TRIP PLANNER</div>
          <h1>Your 2027 plan</h1>
          <p>
            Saved only in this browser. No registration, tracking, or cloud
            sync.
          </p>
        </div>
        <button className="outlineButton" onClick={p.clear}>
          Clear local data
        </button>
      </div>
      {p.ready && (
        <>
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">PERSONAL CALENDAR</div>
                <h2>{planned.length} saved festivals</h2>
              </div>
            </div>
            {!planned.length && (
              <div className="lineupEmpty">
                <strong>No festivals saved yet.</strong>
                <span>Open a festival and choose Save, Going, or Maybe.</span>
              </div>
            )}
            <div className="planList">
              {planned.map((f) => (
                <article key={f.slug}>
                  <div>
                    <small>{f.startDate || "Dates TBA"}</small>
                    <Link href={`/festivals/${f.slug}/`}>
                      <strong>{f.name}</strong>
                    </Link>
                    <span>
                      {f.city} · {f.countryCode}
                    </span>
                  </div>
                  <select
                    value={p.attendance[f.slug] || ""}
                    aria-label={`Attendance for ${f.name}`}
                    onChange={(e) =>
                      p.setAttendance(
                        f.slug,
                        (e.target.value || undefined) as Attendance | undefined,
                      )
                    }
                  >
                    <option value="">No status</option>
                    <option value="going">Going</option>
                    <option value="maybe">Maybe</option>
                    <option value="not-going">Not going</option>
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
                Download calendar (.ics)
              </a>
            )}
          </section>
          <section className="plannerSection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">SELECTION PLAYLIST</div>
                <h2>Build your lineup</h2>
              </div>
              <span>{artists.length} artists</span>
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
              <div className="eyebrow">FAVORITE ARTISTS</div>
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
