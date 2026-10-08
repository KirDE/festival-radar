import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { currentAdmin } from "@/lib/admin-access";
import { currentSessionIdentity } from "@/lib/auth";
import { fetchNovaRockLineupTransport } from "./novarock-https-transport.ts";
import { verifyNovaRockCardDocument } from "./novarock-card-observation.ts";
import { digestNovaRockContent, verifyNovaRockContentSealInTransaction } from "./novarock-content-seal.ts";
import { acquisitionMatchesSource, readAcquisitionProvenance } from "./provenance.ts";

const SOURCE_ID = "cmuaee22i00xy6ncnc5uf6xxk";
const EDITION_ID = "cmuaee1xc00tf6ncn76ea3pu2";
const URL = "https://www.novarock.at/lineup/";
const fail = (reason: string): never => { throw new Error("Nova raw capture: " + reason); };

/** HTTP callers supply only a seal ID. Cookie identity, fixed-target bytes,
 * completion time and current reviewer rights are resolved inside this process.
 * This record cannot approve a candidate or authorize publication. */
export async function captureNovaRockRawCards(sealId: string) {
  if (arguments.length !== 1 || typeof sealId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(sealId)) fail("invalid seal");
  const admin = await currentAdmin(["ADMIN"]);
  const identity = await currentSessionIdentity();
  if (!admin || !identity || admin.id !== identity.userId) fail("authenticated ADMIN session required");
  if (!identity) throw new Error("Missing session identity");
  const boundIdentity = identity;
  const editionBefore = await db.festivalEdition.findUnique({ where: { id: EDITION_ID } });
  if (!editionBefore) throw new Error("Edition missing");
  const editionRevision = editionBefore.updatedAt.getTime();
  const acquired = await fetchNovaRockLineupTransport();
  const raw = Uint8Array.from(acquired.rawBytes);
  return db.$transaction(async (tx) => {
    const seal = await tx.novaRockContentSeal.findUniqueOrThrow({ where: { id: sealId } });
    const content = digestNovaRockContent(seal.snapshot);
    const provenance = readAcquisitionProvenance(content.snapshot.attempt.acquisitionProvenance);
    if (!provenance) throw new Error("Missing sealed provenance");
    if (provenance.configuration.sourceId !== SOURCE_ID || provenance.configuration.editionId !== EDITION_ID) fail("wrong sealed source or edition");
    const config = provenance.configuration;
    // Source first; seal verifier locks run, attempt, candidate in that order.
    await tx.$queryRawUnsafe('SELECT id FROM "FestivalSource" WHERE id = $1 FOR UPDATE', SOURCE_ID);
    const integrity = await verifyNovaRockContentSealInTransaction(tx, sealId);
    if (integrity.candidateId !== content.snapshot.candidate.id || integrity.contentDigest !== content.contentDigest) fail("seal drift");
    await tx.$queryRawUnsafe('SELECT id FROM "Festival" WHERE id = $1 FOR UPDATE', config.festivalId);
    await tx.$queryRawUnsafe('SELECT id FROM "FestivalEdition" WHERE id = $1 FOR UPDATE', EDITION_ID);
    await tx.$queryRawUnsafe('SELECT id FROM "Session" WHERE id = $1 FOR UPDATE', boundIdentity.sessionId);
    await tx.$queryRawUnsafe('SELECT id FROM "User" WHERE id = $1 FOR UPDATE', boundIdentity.userId);
    const source = await tx.festivalSource.findUniqueOrThrow({ where: { id: SOURCE_ID }, include: { edition: true } });
    const festival = await tx.festival.findUniqueOrThrow({ where: { id: config.festivalId } });
    const edition = await tx.festivalEdition.findUniqueOrThrow({ where: { id: EDITION_ID } });
    const candidate = await tx.ingestionCandidate.findUniqueOrThrow({ where: { id: integrity.candidateId } });
    const session = await tx.session.findUnique({ where: { id: boundIdentity.sessionId } });
    const user = await tx.user.findUnique({ where: { id: boundIdentity.userId } });
    if (!session || !user) throw new Error("Revoked reviewer session");
    const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (!session || !user || session.tokenHash !== boundIdentity.tokenHash || session.userId !== user.id ||
        session.expiresAt <= new Date() || user.role !== "ADMIN" || !allowed.includes(user.email.toLowerCase())) fail("reviewer session drift");
    if (festival.id !== source.festivalId || festival.slug !== "nova-rock" ||
        source.editionId !== EDITION_ID || source.editionYear !== 2027 || source.enabled !== true ||
        source.url !== URL || source.parserKey !== "official_markup:nova-rock" ||
        source.strategies.length !== 1 || source.strategies[0] !== "official_markup" ||
        source.fetchUrl !== null || source.followLinkPattern !== null || source.requestHeaders !== null ||
        source.leaseOwner !== null || source.leaseExpiresAt !== null ||
        !acquisitionMatchesSource(content.snapshot.attempt.acquisitionProvenance, source) ||
        edition.festivalId !== festival.id || edition.year !== 2027 || edition.recordState !== "CURRENT" ||
        edition.updatedAt.getTime() !== editionRevision ||
        candidate.reviewState !== "PENDING" || candidate.publishable ||
        content.snapshot.attempt.status !== "REVIEW" || config.festivalId !== festival.id) fail("source or edition drift");
    if (await tx.festivalSource.count({ where: { enabled: true, id: { not: SOURCE_ID }, OR: [
      { editionId: EDITION_ID }, { festivalSlug: "nova-rock", editionYear: 2027 },
    ] } })) fail("competing source");
    const observation = verifyNovaRockCardDocument(raw, content.snapshot);
    if (observation.candidateId !== integrity.candidateId || observation.attemptId !== content.snapshot.attempt.id ||
        observation.sourceId !== SOURCE_ID || observation.contentDigest !== integrity.contentDigest ||
        observation.rawDocumentSha256 !== acquired.rawDocumentSha256 || observation.rawDocumentBytes !== raw.byteLength) fail("transport/document disagreement");
    const row = await tx.novaRockRawCardCapture.create({ data: {
      id: randomUUID(), sealId, candidateId: integrity.candidateId, attemptId: observation.attemptId,
      sourceId: SOURCE_ID, festivalId: festival.id, editionId: EDITION_ID,
      configurationGeneration: provenance.configurationGeneration, leaseVersion: provenance.leaseVersion,
      reviewerId: user.id, sessionId: session.id, rawBytes: raw, rawDocumentSha256: observation.rawDocumentSha256,
      completedAt: acquired.completedAt, cards: observation.cards as unknown as Prisma.InputJsonValue,
    }, select: { id: true, rawDocumentSha256: true } });
    return { authority: "NONE" as const, status: "AUTHENTICATED_RAW_CAPTURE_NON_AUTHORIZING" as const,
      captureId: row.id, rawDocumentSha256: row.rawDocumentSha256, cardCount: observation.cards.length,
      blockers: ["NO_DEPLOYED_EXTRACTOR_ATTESTATION", "NO_ARTIST_ID_REVIEW_DECISION"] as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10000 });
}
