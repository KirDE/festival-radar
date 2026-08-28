import Link from "next/link";
import { notFound } from "next/navigation";
import { allArtists, artistSlug, festivals } from "@/data/festivals";

export const dynamicParams = false;
export function generateStaticParams() { return allArtists.map((name) => ({ slug: artistSlug(name) })); }

export default async function ArtistPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const name = allArtists.find((artist) => artistSlug(artist) === slug);
  if (!name) notFound();
  const appearances = festivals.filter((festival) => [...festival.headliners, ...festival.lineup].includes(name));
  return <div className="artistPage"><Link className="back" href="/">← Festival directory</Link><div className="artistHero"><div className="artistMonogram">{name[0]}</div><div><div className="eyebrow">ARTIST</div><h1>{name}</h1><p>{appearances.length} European festival{appearances.length === 1 ? "" : "s"} announced for 2027</p></div></div><div className="artistActions"><a href={`https://open.spotify.com/search/${encodeURIComponent(name)}`} target="_blank">Spotify ↗</a><a href={`https://www.setlist.fm/search?artistName=${encodeURIComponent(name)}`} target="_blank">setlist.fm ↗</a><a href={`https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=artist`} target="_blank">MusicBrainz ↗</a></div><section className="appearances"><div className="eyebrow">2027 APPEARANCES</div>{appearances.map((festival) => <Link href={`/festivals/${festival.slug}/`} key={festival.slug}><span>{festival.countryCode}</span><strong>{festival.name}</strong><em>{festival.city}</em><b>→</b></Link>)}</section></div>;
}
