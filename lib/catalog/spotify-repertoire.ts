import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';

export const REPERTOIRE_PROFILE_PREFIX = 'spotify-repertoire-profile:';
export const REPERTOIRE_BINDING_PREFIX = 'spotify-repertoire-binding:';
const id = z.string().regex(/^[A-Za-z0-9]{22}$/);
const unique = (values: string[]) => new Set(values).size === values.length;
export const spotifyRepertoireSchema = z.object({
  schemaVersion: z.literal(1),
  key: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,95}$/),
  artistSlugs: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,199}$/)).min(1).max(20).refine(unique),
  setlistArtist: z.string().trim().min(1).max(200),
  searchArtists: z.array(z.object({id, name: z.string().trim().min(1).max(200)}).strict()).min(2).max(8)
    .refine(values => unique(values.map(v => v.id))),
  anchorArtistIds: z.array(id).min(1).max(8).refine(unique),
  collaborationArtistIds: z.array(id).min(1).max(8).refine(unique),
  albumIds: z.array(id).min(1).max(24).refine(unique),
  sourceUrls: z.array(z.string().url().startsWith('https://')).min(1).max(100),
}).strict().refine(profile => {
  const ids = new Set(profile.searchArtists.map(a => a.id));
  return profile.anchorArtistIds.every(value => ids.has(value)) &&
    profile.collaborationArtistIds.every(value => ids.has(value) && !profile.anchorArtistIds.includes(value));
}, 'Repertoire anchor/collaboration IDs must be distinct reviewed search identities');

export type SpotifyRepertoireProfile = z.infer<typeof spotifyRepertoireSchema>;

/** Provider selection policy is not an equivalence between artist identities. */
export async function spotifyRepertoiresForArtists(
  db: Pick<PrismaClient, 'operationalState'>,
  artists: {slug: string; name: string}[],
): Promise<Record<string, SpotifyRepertoireProfile>> {
  if (!artists.length) return {};
  const bindings = await db.operationalState.findMany({where: {key: {in: artists.map(a => REPERTOIRE_BINDING_PREFIX + a.slug)}}});
  const keys = bindings.map(row => {
    const binding = z.object({profileKey: z.string().regex(/^[a-z0-9][a-z0-9:-]{0,95}$/)}).strict().parse(row.payload);
    return REPERTOIRE_PROFILE_PREFIX + binding.profileKey;
  });
  if (!keys.length) return {};
  const rows = await db.operationalState.findMany({where: {key: {in: [...new Set(keys)]}}});
  const profiles = new Map(rows.map(row => {
    const profile = spotifyRepertoireSchema.parse(row.payload);
    if (row.key !== REPERTOIRE_PROFILE_PREFIX + profile.key) throw new Error('Repertoire profile key mismatch');
    return [row.key, profile];
  }));
  const result: Record<string, SpotifyRepertoireProfile> = {};
  for (let i = 0; i < bindings.length; i++) {
    const profile = profiles.get(keys[i]);
    const artist = artists.find(a => REPERTOIRE_BINDING_PREFIX + a.slug === bindings[i].key);
    if (!profile || !artist || !profile.artistSlugs.includes(artist.slug)) throw new Error('Missing or mismatched repertoire binding');
    if (Object.hasOwn(result, artist.name)) throw new Error('Ambiguous repertoire artist name');
    result[artist.name] = profile;
  }
  return result;
}
