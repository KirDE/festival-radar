"use client";

import Link from "next/link";
import type { Festival } from "@/data/festivals";
import type { ArtistProfile } from "@/data/artists";
import { useLanguage } from "./LanguageProvider";

export function ArtistDetail({ artist, appearances }: { artist: ArtistProfile; appearances: Festival[] }) {
  const { language, t } = useLanguage();
  const festivalWord = appearances.length === 1 ? t("europeanFestival") : t("europeanFestivals");
  const sentence = language === "ru" ? `${t("announcedFor")}: ${appearances.length} ${festivalWord}` : `${appearances.length} ${festivalWord} ${t("announcedFor")}`;
  return <div className="artistPage"><Link className="back" href="/">← {t("festivalDirectory")}</Link><div className="artistHero"><div className="artistMonogram">{artist.name[0]}</div><div><div className="eyebrow">{t("artist")}</div><h1>{artist.name}</h1><p>{sentence}</p>{artist.aliases.length > 0 && <small>Also known as {artist.aliases.join(", ")}</small>}</div></div><div className="artistActions">{artist.links.map((link) => <a href={link.url} key={`${link.source}-${link.label}`} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</div>{(artist.biography || artist.genres.length > 0) && <section className="artistMetadata"><div><div className="eyebrow">Profile</div>{artist.biography && <p>{artist.biography}</p>}{artist.origin && <p><strong>Origin:</strong> {artist.origin}</p>}{artist.genres.length > 0 && <p><strong>Genres:</strong> {artist.genres.join(" · ")}</p>}</div>{artist.topTracks.length > 0 && <div><div className="eyebrow">Top tracks</div><ol>{artist.topTracks.map((track) => <li key={track}>{track}</li>)}</ol></div>}</section>}<section className="appearances"><div className="eyebrow">{t("appearances")}</div>{appearances.map((festival) => <Link href={`/festivals/${festival.slug}/`} key={festival.slug}><span>{festival.countryCode}</span><strong>{festival.name}</strong><em>{festival.city}</em><b>→</b></Link>)}</section><details className="artistSources"><summary>Sources and canonical identities</summary>{Object.entries(artist.identities).map(([source, id]) => id && <code key={source}>{source}: {id}</code>)}{artist.provenance.map((item, index) => <a href={item.url} key={`${item.source}-${index}`} target="_blank" rel="noreferrer">{item.field}: {item.source} · checked {item.checkedAt}</a>)}</details></div>;
}
