"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import type { ArtistProfile } from "@/data/artists";
import { useLanguage } from "./LanguageProvider";
import { FavoriteButton } from "./LocalPlanner";

export function ArtistDetail({
  artist,
  appearances,
}: {
  artist: ArtistProfile;
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
      <FavoriteButton kind="artist" value={artist.name} />
      <div className="artistHero">
        {artist.image ? (
          <img className="artistPortrait" src={artist.image.url} alt={artist.image.alt} width={artist.image.width} height={artist.image.height} />
        ) : (
          <div className="artistMonogram" aria-hidden="true">{artist.name[0]}</div>
        )}
        <div>
          <div className="eyebrow">{t("artist")}</div>
          <h1>{artist.name}</h1>
          <p>{sentence}</p>
          {artist.aliases.length > 0 && (
            <small>{t("alsoKnownAs")} {artist.aliases.join(", ")}</small>
          )}
        </div>
      </div>
      <div className="artistActions">
        {artist.links.filter((link) => link.verified).map((link) => (
          <a
            href={link.url}
            key={`${link.source}-${link.label}`}
            target="_blank"
            rel="noreferrer"
          >
            {link.label} ↗
          </a>
        ))}
      </div>
      {(artist.biography || artist.genres.length > 0) && (
        <section className="artistMetadata">
          <div>
            <div className="eyebrow">{t("profile")}</div>
            {artist.biography && <p>{artist.biography}</p>}
            {artist.origin && (
              <p>
                <strong>{t("origin")}:</strong> {artist.origin}
              </p>
            )}
            {artist.genres.length > 0 && (
              <p>
                <strong>{t("genres")}:</strong> {artist.genres.join(" · ")}
              </p>
            )}
          </div>
          {artist.topTracks.length > 0 && (
            <div>
              <div className="eyebrow">{t("topTracks")}</div>
              <ol>
                {artist.topTracks.map((track) => (
                  <li key={track}>{track}</li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
      {artist.recentSetlists.length > 0 && (
        <section className="artistSetlists" aria-labelledby="recent-setlists-heading">
          <div className="eyebrow" id="recent-setlists-heading">Recent setlists</div>
          <ul>
            {artist.recentSetlists.map((setlist) => (
              <li key={`${setlist.date}-${setlist.url}`}>
                <time dateTime={setlist.date}>{setlist.date}</time>
                <span>{setlist.venue}</span>
                <a href={setlist.url} target="_blank" rel="noreferrer" aria-label={`View ${artist.name} setlist from ${setlist.date}`}>View setlist ↗</a>
              </li>
            ))}
          </ul>
        </section>
      )}
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
      <details className="artistSources">
        <summary>{t("sourcesAndIdentities")}</summary>
        {Object.entries(artist.identities).map(
          ([source, id]) =>
            id && (
              <code key={source}>
                {source}: {id}
              </code>
            ),
        )}
        {artist.provenance.map((item, index) => (
          <a
            href={item.url}
            key={`${item.source}-${index}`}
            target="_blank"
            rel="noreferrer"
          >
            {item.field}: {item.source} · {t("checked")} {item.checkedAt}
          </a>
        ))}
        <p className="freshnessNote">
          Profile refreshed every {artist.freshness.profile.cadenceDays} days; music every {artist.freshness.music.cadenceDays} days; setlists every {artist.freshness.setlists.cadenceDays} days.
        </p>
      </details>
    </div>
  );
}
