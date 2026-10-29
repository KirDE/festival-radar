import { createHash } from 'node:crypto';
import { db } from '../lib/db.ts';
import { REPERTOIRE_BINDING_PREFIX, REPERTOIRE_PROFILE_PREFIX, spotifyRepertoireSchema } from '../lib/catalog/spotify-repertoire.ts';

// Private stdin configuration; no catalogue identities, plans or providers changed.
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new Error('Only --apply is supported');
const parts: Buffer[] = []; let size = 0;
for await (const part of process.stdin) {
  size += part.length; if (size > 64 * 1024) throw new Error('Repertoire configuration too large');
  parts.push(part);
}
try {
  const profile = spotifyRepertoireSchema.parse(JSON.parse(Buffer.concat(parts).toString('utf8')));
  const profileKey = REPERTOIRE_PROFILE_PREFIX + profile.key;
  const hash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  const result = await db.$transaction(async tx => {
    const artists = await tx.artist.findMany({where: {slug: {in: profile.artistSlugs}}, select: {slug: true, name: true}});
    if (artists.length !== profile.artistSlugs.length) throw new Error('All repertoire acts must already exist');
    const existing = await tx.operationalState.findUnique({where: {key: profileKey}});
    if (existing && JSON.stringify(spotifyRepertoireSchema.parse(existing.payload)) !== JSON.stringify(profile))
      throw new Error('Existing profile differs; create a reviewed revision, do not overwrite in place');
    for (const artist of artists) {
      const binding = await tx.operationalState.findUnique({where: {key: REPERTOIRE_BINDING_PREFIX + artist.slug}});
      if (binding && JSON.stringify(binding.payload) !== JSON.stringify({profileKey: profile.key}))
        throw new Error('Artist already has a different repertoire binding');
    }
    if (args[0] === '--apply') {
      if (!existing) await tx.operationalState.create({data: {key: profileKey, payload: profile}});
      for (const artist of artists) await tx.operationalState.upsert({
        where: {key: REPERTOIRE_BINDING_PREFIX + artist.slug},
        create: {key: REPERTOIRE_BINDING_PREFIX + artist.slug, payload: {profileKey: profile.key}}, update: {},
      });
      const auditKey = 'spotify-repertoire-audit:' + profile.key;
      await tx.operationalState.upsert({where: {key: auditKey},
        create: {key: auditKey, payload: {schemaVersion: 1, profileKey, profileHash: hash, artistSlugs: profile.artistSlugs,
          sourceUrls: profile.sourceUrls, configuredAt: new Date().toISOString(), providerWrites: 0}}, update: {}});
    }
    return {profileKey, hash, artists, apply: args[0] === '--apply', existing: Boolean(existing), providerWrites: 0};
  }, {isolationLevel: 'Serializable'});
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
