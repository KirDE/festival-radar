import { AdminChangeStatus, AdminDraftStatus, AdminResourceKind, AdminRunStatus, Prisma } from "@prisma/client";
import { festivals } from "@/data/festivals";
import { getFestivalSource } from "@/data/festival-sources";
import { db } from "@/lib/db";
import { extractFestivalCandidate } from "@/lib/ingestion/extract";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const kind = (value: string) => AdminResourceKind[value.toUpperCase() as keyof typeof AdminResourceKind];

export async function adminSnapshot() {
  const [drafts, resources, changes, runs, audit] = await Promise.all([
    db.adminDraft.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    db.adminResourceState.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }),
    db.adminChange.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.adminParserRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 }),
    db.adminAuditEntry.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  return { drafts, resources, changes, runs, audit };
}

export async function saveDraft(input: { resourceKind: string; resourceKey: string; baseRevision: number; values: unknown }, actor: { id: string; email: string }) {
  const resourceKind = kind(input.resourceKind);
  if (!resourceKind || !input.resourceKey || !Number.isInteger(input.baseRevision) || typeof input.values !== "object" || !input.values) throw new Error("Invalid draft");
  return db.$transaction(async (tx) => {
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind, resourceKey: input.resourceKey } } });
    const currentRevision = resource?.revision ?? 0;
    if (input.baseRevision !== currentRevision) throw new Error(`Revision conflict: expected ${currentRevision}`);
    const values = input.values as Record<string, unknown>;
    if (!Object.keys(values).length) throw new Error("Draft has no fields");
    const draft = await tx.adminDraft.create({ data: { resourceKind, resourceKey: input.resourceKey, baseRevision: currentRevision, revision: currentRevision + 1, status: AdminDraftStatus.QUEUED, values: json(values), validation: json({ valid: true, checkedAt: new Date().toISOString() }), createdById: actor.id } });
    const before = resource?.values && typeof resource.values === "object" && !Array.isArray(resource.values) ? resource.values as Record<string, unknown> : {};
    await tx.adminChange.createMany({ data: Object.entries(values).map(([field, afterValue]) => ({ resourceKind, resourceKey: input.resourceKey, field, baseRevision: currentRevision, beforeValue: json(before[field] ?? null), afterValue: json(afterValue ?? null), sourceEvidence: json({ kind: "operator-draft", draftId: draft.id }), confidence: 100, draftId: draft.id })) });
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: "DRAFT_SAVED", resourceKind, resourceKey: input.resourceKey, afterValue: json(input.values), metadata: json({ revision: draft.revision }) } });
    return draft;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function decideChange(id: string, decision: "approve" | "reject", actor: { id: string; email: string }) {
  return db.$transaction(async (tx) => {
    const change = await tx.adminChange.findUnique({ where: { id } });
    if (!change || change.status !== AdminChangeStatus.PENDING) throw new Error("Change is no longer pending");
    const resource = await tx.adminResourceState.findUnique({ where: { resourceKind_resourceKey: { resourceKind: change.resourceKind, resourceKey: change.resourceKey } } });
    const currentRevision = resource?.revision ?? 0;
    if (decision === "approve" && currentRevision !== change.baseRevision) {
      await tx.adminChange.update({ where: { id }, data: { status: AdminChangeStatus.CONFLICT } });
      throw new Error(`Revision conflict: expected ${currentRevision}`);
    }
    const status = decision === "approve" ? AdminChangeStatus.APPROVED : AdminChangeStatus.REJECTED;
    const updated = await tx.adminChange.updateMany({ where: { id, status: AdminChangeStatus.PENDING }, data: { status, decidedById: actor.id, decidedAt: new Date() } });
    if (updated.count !== 1) throw new Error("Change was decided concurrently");
    if (decision === "approve") {
      const existing = resource?.values && typeof resource.values === "object" && !Array.isArray(resource.values) ? resource.values as Record<string, unknown> : {};
      await tx.adminResourceState.upsert({ where: { resourceKind_resourceKey: { resourceKind: change.resourceKind, resourceKey: change.resourceKey } }, create: { resourceKind: change.resourceKind, resourceKey: change.resourceKey, revision: currentRevision + 1, values: json({ ...existing, [change.field]: change.afterValue }) }, update: { revision: { increment: 1 }, values: json({ ...existing, [change.field]: change.afterValue }) } });
      if (change.draftId) await tx.adminChange.updateMany({ where: { draftId: change.draftId, status: AdminChangeStatus.PENDING, NOT: { id } }, data: { baseRevision: currentRevision + 1 } });
    }
    if (change.draftId) {
      const pending = await tx.adminChange.count({ where: { draftId: change.draftId, status: AdminChangeStatus.PENDING, NOT: { id } } });
      if (!pending) await tx.adminDraft.update({ where: { id: change.draftId }, data: { status: decision === "approve" ? AdminDraftStatus.APPLIED : AdminDraftStatus.REJECTED } });
    }
    await tx.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: decision === "approve" ? "CHANGE_APPROVED" : "CHANGE_REJECTED", resourceKind: change.resourceKind, resourceKey: change.resourceKey, beforeValue: json(change.beforeValue), afterValue: json(change.afterValue), evidence: json(change.sourceEvidence), metadata: json({ changeId: change.id, field: change.field }) } });
    return tx.adminChange.findUniqueOrThrow({ where: { id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function refreshFestival(slug: string, actor: { id: string; email: string }) {
  const source = getFestivalSource(slug); const festival = festivals.find((item) => item.slug === slug);
  if (!source || !festival || !source.enabled) throw new Error("Festival source is not configured");
  const run = await db.adminParserRun.create({ data: { festivalSlug: slug, sourceId: source.url, adapter: source.strategies.join(","), requestedById: actor.id, log: json([{ at: new Date().toISOString(), message: "Fetch started" }]) } });
  const started = Date.now();
  try {
    const response = await fetch(source.url, { headers: { "User-Agent": "FestivalRadarAdmin/1.0" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const candidate = extractFestivalCandidate(await response.text(), source, new Date().toISOString());
    const fields = ["startDate", "endDate", "city", "headliners", "lineup", "ticketsUrl", "status"] as const;
    const changes = fields.filter((field) => candidate[field] !== undefined && JSON.stringify(candidate[field]) !== JSON.stringify(festival[field])).map((field) => ({ resourceKind: AdminResourceKind.FESTIVAL, resourceKey: slug, field, baseRevision: 0, beforeValue: json(festival[field] ?? null), afterValue: json(candidate[field] ?? null), sourceEvidence: json(candidate.evidence.filter((item) => item.field === field)), confidence: candidate.evidence.some((item) => item.field === field) ? 90 : 60, parserRunId: run.id }));
    if (changes.length) await db.adminChange.createMany({ data: changes });
    const finishedAt = new Date();
    const updated = await db.adminParserRun.update({ where: { id: run.id }, data: { status: candidate.warnings.length ? AdminRunStatus.PARTIAL : AdminRunStatus.SUCCEEDED, finishedAt, durationMs: Date.now() - started, extracted: candidate.evidence.length, message: `${changes.length} change(s) queued`, log: json([{ at: run.startedAt.toISOString(), message: "Fetch started" }, { at: finishedAt.toISOString(), message: "Parse completed", warnings: candidate.warnings, queued: changes.length }]) } });
    await db.adminAuditEntry.create({ data: { actorId: actor.id, actorLabel: actor.email, action: "FESTIVAL_REFRESHED", resourceKind: AdminResourceKind.FESTIVAL, resourceKey: slug, evidence: json({ source: source.url }), metadata: json({ runId: run.id, queued: changes.length }) } });
    return updated;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Refresh failed";
    await db.adminParserRun.update({ where: { id: run.id }, data: { status: AdminRunStatus.FAILED, finishedAt: new Date(), durationMs: Date.now() - started, message, log: json([{ at: new Date().toISOString(), message }]) } });
    throw new Error(message);
  }
}
