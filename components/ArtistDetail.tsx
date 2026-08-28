"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import { useLanguage } from "./LanguageProvider";
import { FavoriteButton } from "./LocalPlanner";

export function ArtistDetail({
  name,
  appearances,
}: {
  name: string;
  appearances: Festival[];
}) {
  const { language, t } = useLanguage();
  const festivalWord =
    appearances.length === 1 ? t("europeanFestival") : t("europeanFestivals");
  const sentence =
    language === "ru"
      ? `${t("announcedFor")}: ${appearances.length} ${festivalWord}`
      : `${appearances.length} ${festivalWord} ${t("announcedFor")}`;
  return (
    <div className="artistPage">
      <Link className="back" href="/">
        ← {t("festivalDirectory")}
      </Link>
      <FavoriteButton kind="artist" value={name} />
      <div className="artistHero">
        <div className="artistMonogram">{name[0]}</div>
        <div>
          <div className="eyebrow">{t("artist")}</div>
          <h1>{name}</h1>
          <p>{sentence}</p>
        </div>
      </div>
      <div className="artistActions">
        <a
          href={`https://open.spotify.com/search/${encodeURIComponent(name)}`}
          target="_blank"
          rel="noreferrer"
        >
          Spotify ↗
        </a>
        <a
          href={`https://www.setlist.fm/search?artistName=${encodeURIComponent(name)}`}
          target="_blank"
          rel="noreferrer"
        >
          setlist.fm ↗
        </a>
        <a
          href={`https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=artist`}
          target="_blank"
          rel="noreferrer"
        >
          MusicBrainz ↗
        </a>
      </div>
      <section className="appearances">
        <div className="eyebrow">{t("appearances")}</div>
        {appearances.map((festival) => (
          <Link href={`/festivals/${festival.slug}/`} key={festival.slug}>
            <span>{festival.countryCode}</span>
            <strong>{festival.name}</strong>
            <em>{festival.city}</em>
            <b>→</b>
          </Link>
        ))}
      </section>
    </div>
  );
}
