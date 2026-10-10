import {
  Prisma,
  type PrismaClient,
  type Prisma as PrismaTypes,
} from "@prisma/client";
import { failureRetryAt } from "./failure-policy.ts";
import { enqueueParserRepair } from "./parser-repairs.ts";
import { randomUUID } from "node:crypto";
import {
  fingerprint,
  ImportAgentError,
  decisionSchema,
  type AgentDecision,
} from "./agent-contract.ts";
import { mapSource, validateSource } from "../sources/repository.ts";
import { publishAgentFestivalResolution } from "../catalog/publication.ts";

type Database = PrismaClient | PrismaTypes.TransactionClient;
const prefix = "ingestion-agent-";
const config = (s: {
  id: string;
  festivalSlug: string;
  url: string;
  parserKey: string | null;
  editionId: string | null;
  editionYear: number;
  strategies: string[];
}) => ({
  id: s.id,
  slug: s.festivalSlug,
  url: s.url,
  parserKey: s.parserKey,
  editionId: s.editionId,
  year: s.editionYear,
  strategies: s.strategies,
});
const fields = [
  "startDate",
  "endDate",
  "city",
  "status",
  "ticketStatus",
  "ticketsUrl",
  "headliners",
  "lineup",
  "observedEditionYears",
];
export async function inspectSource(db: Database, sourceId: string) {
  const s = await db.festivalSource.findUnique({
    where: { id: sourceId },
    include: {
      festival: true,
      edition: {
        include: {
          lineup: {
            include: {
              artist: { select: { id: true, name: true, slug: true } },
            },
            orderBy: [{ billing: "asc" }, { position: "asc" }],
          },
        },
      },
    },
  });
  if (
    !s?.enabled ||
    !!s.deprecatedAt ||
    !s.festival ||
    !s.edition ||
    s.edition.festivalId !== s.festivalId ||
    s.edition.year !== s.editionYear ||
    s.edition.recordState !== "CURRENT"
  )
    return null;
  const a = await db.ingestionAttempt.findFirst({
    where: {
      festivalSlug: s.festivalSlug,
      requestedUrl: s.url,
      endedAt: { gte: s.configurationBackfilledAt ?? s.createdAt },
    },
    orderBy: [{ endedAt: "desc" }, { id: "desc" }],
    include: { candidate: { include: { evidence: true, diffs: true } } },
  });
  const c = a?.candidate;
  const manual = s.strategies.includes("manual_review");
  if (
    !manual &&
    !a &&
    s.configurationBackfilledAt &&
    (!s.lastAttemptAt || s.lastAttemptAt < s.configurationBackfilledAt)
  )
    return null;
  const failed =
    s.consecutiveFailures > 0 ||
    (a?.status === "FAILED" &&
      (!s.lastSuccessAt || s.lastSuccessAt < a.endedAt));
  const review = a?.status === "REVIEW" && c?.reviewState === "PENDING";
  if (!manual && !failed && !review) return null;
  const kind = failed ? "failure" : manual ? "manual_source" : "review";
  const normalized = (c?.normalized ?? {}) as Record<string, unknown>;
  const facts = Object.fromEntries(
    fields
      .filter((k) => Object.hasOwn(normalized, k))
      .map((k) => [k, normalized[k]]),
  );
  const issueId = fingerprint({
    source: config(s),
    kind,
    facts,
    warnings: c?.warnings ?? [],
    diffs:
      c?.diffs
        .map((d) => ({
          field: d.field,
          before: d.beforeValue,
          after: d.afterValue,
          review: d.reviewRequired,
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) ??
      [],
    failure: failed
      ? {
          httpStatus: a?.httpStatus ?? null,
          error: s.lastError ?? a?.error ?? null,
        }
      : null,
  });
  const current = {
    festivalId: s.festivalId,
    editionId: s.editionId,
    year: s.editionYear,
    name: s.festival.name,
    city: s.festival.city,
    startDate: s.edition.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: s.edition.endDate?.toISOString().slice(0, 10) ?? null,
    status: s.edition.status.toLowerCase(),
    completeness: s.edition.completeness.toLowerCase(),
    ticketStatus: s.edition.ticketStatus.toLowerCase(),
    ticketsUrl: s.edition.ticketsUrl,
    headliners: s.edition.lineup
      .filter((l) => l.billing === "HEADLINER" && l.status === "ANNOUNCED")
      .map((l) => l.artist.name),
    lineup: s.edition.lineup
      .filter((l) => l.billing === "LINEUP" && l.status === "ANNOUNCED")
      .map((l) => l.artist.name),
    entries: s.edition.lineup.map((l) => ({
      artistId: l.artistId,
      billing: l.billing,
      status: l.status,
      position: l.position,
    })),
    updatedAt: s.edition.updatedAt.toISOString(),
  };
  const snapshot = fingerprint({
    config: config(s),
    candidateId: c?.id ?? null,
    attemptId: a?.id ?? null,
    current,
  });
  // Request headers, credentials and raw server errors never enter agent data.
  const error = s.lastError ?? a?.error ?? "";
  const failureCategory = failed
    ? /timeout|abort/i.test(error)
      ? "timeout"
      : /fetch|network|ECONN|ENOTFOUND|certificate/i.test(error)
        ? "network"
        : a?.httpStatus && a.httpStatus >= 400
          ? "http"
          : "extraction_or_validation"
    : null;
  return {
    issueId,
    key: prefix + issueId,
    snapshot,
    sourceId: s.id,
    festivalSlug: s.festivalSlug,
    kind,
    failureCategory,
    source: {
      ...config(s),
      refreshPolicy: s.refreshPolicy,
      manualReviewReason: s.manualReviewReason,
      officialUrl: s.festival.officialUrl,
      fetchUrl: s.fetchUrl,
      consecutiveFailures: s.consecutiveFailures,
      lastAttemptAt: s.lastAttemptAt,
      nextRunAt: s.nextRunAt,
      leaseExpiresAt: s.leaseExpiresAt,
    },
    current,
    candidate: c
      ? {
          id: c.id,
          facts,
          warnings: c.warnings,
          evidence: c.evidence.map((e) => ({
            field: e.field,
            url: e.sourceUrl,
            observedAt: e.observedAt,
            contentHash: e.contentHash,
            excerpt: e.excerpt,
          })),
          diffs: c.diffs.map((d) => ({
            field: d.field,
            before: d.beforeValue,
            after: d.afterValue,
            reviewRequired: d.reviewRequired,
          })),
        }
      : null,
    attempt: a
      ? {
          id: a.id,
          status: a.status,
          httpStatus: a.httpStatus,
          requestedUrl: a.requestedUrl,
          finalUrl: a.finalUrl,
          endedAt: a.endedAt,
        }
      : null,
  };
}

export async function listAgentIssues(db: Database, now = new Date()) {
  const sources = await db.festivalSource.findMany({
    where: { enabled: true, editionId: { not: null } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 1001,
  });
  if (sources.length > 1000) throw new ImportAgentError("invalid");
  const entries = [];
  for (const s of sources) {
    const issue = await inspectSource(db, s.id);
    if (issue) entries.push(issue);
  }
  const states = await db.operationalState.findMany({
    where: { key: { in: entries.map((i) => i.key) } },
  });
  const ready = entries.filter((i) => {
    const state = states.find((s) => s.key === i.key),
      p = (state?.payload ?? {}) as Record<string, unknown>;
    if (state?.leaseOwner && state.leaseExpiresAt && state.leaseExpiresAt > now)
      return false;
    if (p.status === "needs_user") return false;
    // No-op manual reviews are reconsidered weekly, even without parser changes.
    if (p.status === "resolved" && i.kind !== "manual_source") return false;
    if (p.retryAt && new Date(String(p.retryAt)) > now) return false;
    if (i.kind === "failure" && Number(p.attempts ?? 0) > 0 && i.source.nextRunAt && i.source.nextRunAt > now) return false;
    if (i.source.leaseExpiresAt && i.source.leaseExpiresAt > now) return false;
    return true;
  });
  return {
    complete: true,
    total: entries.length,
    ready: ready.length,
    revision: fingerprint(
      ready.map((i) => ({
        id: i.issueId,
        attempt: i.attempt?.id ?? null,
        state: states.find((s) => s.key === i.key)?.updatedAt ?? null,
      })),
    ),
    issues: ready.slice(0, 10),
  };
}

export async function claimAgentIssue(
  db: PrismaClient,
  sourceId: string,
  issueId: string,
) {
  return db.$transaction(
    async (tx) => {
      const i = await inspectSource(tx, sourceId);
      if (!i || i.issueId !== issueId) throw new ImportAgentError("stale");
      if (i.source.leaseExpiresAt && i.source.leaseExpiresAt > new Date())
        throw new ImportAgentError("busy");
      await tx.$executeRaw`INSERT INTO "OperationalState" (key,payload,"updatedAt") VALUES (${i.key},'{}'::jsonb,(clock_timestamp() AT TIME ZONE 'UTC')) ON CONFLICT (key) DO NOTHING`;
      const token = randomUUID();
      const rows = await tx.$queryRaw<
        { payload: Record<string, unknown> }[]
      >`UPDATE "OperationalState" SET "leaseOwner"=${token},"leaseExpiresAt"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours',"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC') WHERE key=${i.key} AND ("leaseOwner" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) AND COALESCE(payload->>'status','') <> 'needs_user' AND (payload->>'retryAt' IS NULL OR (payload->>'retryAt')::timestamptz <= clock_timestamp()) RETURNING payload`;
      if (rows.length !== 1) throw new ImportAgentError("busy");
      if (rows[0].payload.status === "resolved" && i.kind !== "manual_source")
        throw new ImportAgentError("stale");
      return {
        ...i,
        leaseToken: token,
        ownerClarification:
          typeof rows[0].payload.answer === "string"
            ? rows[0].payload.answer
            : null,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}

// A stale decision must not strand the case behind its two-hour crash lease.
// Releasing requires its exact capability; it never writes catalog/source data.
export async function releaseAgentIssue(
  db: PrismaClient,
  issueId: string,
  leaseToken: string,
) {
  const result = await db.operationalState.updateMany({
    where: { key: prefix + issueId, leaseOwner: leaseToken },
    data: { leaseOwner: null, leaseExpiresAt: null },
  });
  if (result.count !== 1) throw new ImportAgentError("busy");
  return { released: true };
}

export async function resumeAgentIssue(
  db: PrismaClient,
  sourceId: string,
  issueId: string,
  answer: string,
) {
  return db.$transaction(
    async (tx) => {
      const issue = await inspectSource(tx, sourceId);
      if (!issue || issue.issueId !== issueId)
        throw new ImportAgentError("stale");
      const rows = await tx.$queryRaw<
        { payload: Record<string, unknown> }[]
      >`SELECT payload FROM "OperationalState" WHERE key=${issue.key} AND payload->>'status'='needs_user' AND "leaseOwner" IS NULL FOR UPDATE`;
      if (rows.length !== 1) throw new ImportAgentError("busy");
      const payload = {
        status: "retry",
        attempts: rows[0].payload.attempts ?? 0,
        retryAt: new Date().toISOString(),
        answer,
      };
      await tx.operationalState.update({
        where: { key: issue.key },
        data: { payload },
      });
      await tx.adminAuditEntry.create({
        data: {
          actorLabel: "OpenClaw import-conflict agent",
          action: "ingestion.agent.resume",
          resourceKind: "FESTIVAL",
          resourceKey: issue.festivalSlug,
          beforeValue: rows[0].payload as PrismaTypes.InputJsonValue,
          afterValue: payload,
          metadata: { issueId, sourceId },
        },
      });
      return { resumed: true };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}

function allowedEvidence(
  i: NonNullable<Awaited<ReturnType<typeof inspectSource>>>,
  d: AgentDecision,
  now: Date,
) {
  const urls = [
    i.source.url,
    i.source.officialUrl,
    i.source.fetchUrl,
    i.current.ticketsUrl,
  ].filter((v): v is string => !!v);
  const hosts = new Set(urls.map((u) => new URL(u).hostname));
  const valid = (u: string) => {
    const x = new URL(u);
    return (
      x.protocol === "https:" &&
      !x.username &&
      !x.password &&
      (!x.port || x.port === "443") &&
      hosts.has(x.hostname)
    );
  };
  for (const e of d.evidence)
    if (
      !valid(e.url) ||
      new Date(e.checkedAt) > new Date(now.getTime() + 60000) ||
      new Date(e.checkedAt) < new Date(now.getTime() - 86400000)
    )
      throw new ImportAgentError("invalid");
  for (const field of Object.keys(d.facts ?? {}))
    if (!d.evidence.some((e) => e.field === field))
      throw new ImportAgentError("invalid");
  if (
    d.source &&
    (!valid(d.source.url) ||
      !d.evidence.some((e) => e.field === "source" && e.url === d.source!.url))
  )
    throw new ImportAgentError("invalid");
  if (d.facts?.ticketsUrl && !valid(d.facts.ticketsUrl))
    throw new ImportAgentError("invalid");
}

export async function resolveAgentIssue(
  db: PrismaClient,
  input: {
    sourceId: string;
    issueId: string;
    leaseToken: string;
    snapshot: string;
    decision: unknown;
  },
) {
  const d = decisionSchema.parse(input.decision),
    key = prefix + input.issueId,
    now = new Date();
  return db.$transaction(
    async (tx) => {
      const held = await tx.$queryRaw<
        { payload: Record<string, unknown>; active: boolean }[]
      >`SELECT payload,("leaseOwner"=${input.leaseToken} AND "leaseExpiresAt">(clock_timestamp() AT TIME ZONE 'UTC')) AS active FROM "OperationalState" WHERE key=${key} FOR UPDATE`;
      if (held.length !== 1) throw new ImportAgentError("busy");
      const previous = held[0].payload;
      if (
        previous.leaseDigest === fingerprint(input.leaseToken) &&
        previous.snapshot === input.snapshot &&
        previous.decisionHash === fingerprint(d)
      ) {
        const {
          leaseDigest: _l,
          snapshot: _s,
          decisionHash: _d,
          ...receipt
        } = previous;
        return receipt;
      }
      if (!held[0].active) throw new ImportAgentError("busy");
      const i = await inspectSource(tx, input.sourceId);
      if (!i || i.issueId !== input.issueId || i.snapshot !== input.snapshot)
        throw new ImportAgentError("stale");
      const sources = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM "FestivalSource" WHERE id=${i.sourceId} AND ("leaseOwner" IS NULL OR "leaseExpiresAt" <= (clock_timestamp() AT TIME ZONE 'UTC')) FOR UPDATE`;
      if (sources.length !== 1) throw new ImportAgentError("busy");
      allowedEvidence(i, d, now);
      let publication = null;
      if (d.action === "apply") {
        if (d.facts)
          publication = await publishAgentFestivalResolution(tx, {
            editionId: i.current.editionId!,
            festivalSlug: i.festivalSlug,
            sourceId: "openclaw:" + i.issueId + ":" + i.snapshot,
            reason: d.reason,
            facts: d.facts,
            evidence: d.evidence,
            observedAt: now,
          });
        if (d.source) {
          const s = await tx.festivalSource.findUniqueOrThrow({
            where: { id: i.sourceId },
            include: { edition: { select: { festivalId: true, year: true } } },
          });
          const parserKey = validateSource({
            festivalSlug: s.festivalSlug,
            editionYear: s.editionYear,
            enabled: s.enabled,
            ...d.source,
          });
          const updated = await tx.festivalSource.update({
            where: { id: s.id },
            data: {
              ...d.source,
              manualReviewReason: d.source.manualReviewReason ?? null,
              parserKey,
              cadenceSeconds: {
                daily: 86400,
                every_3_days: 259200,
                weekly: 604800,
              }[d.source.refreshPolicy],
              configurationBackfilledAt: now,
              nextRunAt: now,
              httpEtag: null,
              httpLastModified: null,
            },
          });
          mapSource({ ...updated, edition: s.edition });
        }
      }
      if (i.candidate && ["apply", "dismiss"].includes(d.action))
        await tx.ingestionCandidate.update({
          where: { id: i.candidate.id },
          data: {
            reviewState:
              d.action === "dismiss"
                ? "REJECTED"
                : publication
                  ? "PUBLISHED"
                  : "SUPERSEDED",
            reviewActor: "openclaw-import-agent",
            reviewedAt: now,
            publishedAt: publication ? now : null,
            catalogueVersion: publication?.id ?? null,
          },
        });
      const attempts = Number(held[0].payload.attempts ?? 0) + 1;
      const retryFailure = d.action === "apply" && i.kind === "failure" && !d.source;
      const retryAt = d.action === "retry" || retryFailure
        ? failureRetryAt(Math.max(attempts, i.source.consecutiveFailures || 1), now).toISOString()
        : i.kind === "manual_source" && !d.source ? new Date(now.getTime() + 604800000).toISOString() : null;
      const parserRepairId = ["apply", "dismiss"].includes(d.action) && (d.facts || d.source || i.candidate)
        ? await enqueueParserRepair(tx, { sourceId: i.sourceId, festivalSlug: i.festivalSlug, issueId: i.issueId,
            parserKey: i.source.parserKey, sourceUrl: i.source.fetchUrl ?? i.source.url, year: i.current.year,
            reason: d.reason, decision: d, candidate: i.candidate, current: i.current }) : null;
      const status =
        d.action === "needs_user"
          ? "needs_user"
          : d.action === "retry" || retryFailure
            ? "retry"
            : "resolved";
      const receipt = {
        status,
        attempts,
        retryAt,
        reason: d.reason,
        question: d.question ?? null,
        publicationId: publication?.id ?? null,
        parserRepairId,
        providerJobs: 0,
        at: now.toISOString(),
      };
      await tx.operationalState.update({
        where: { key },
        data: {
          payload: {
            ...receipt,
            leaseDigest: fingerprint(input.leaseToken),
            snapshot: input.snapshot,
            decisionHash: fingerprint(d),
          },
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      await tx.adminAuditEntry.create({
        data: {
          actorLabel: "OpenClaw import-conflict agent",
          action: "ingestion.agent." + d.action,
          resourceKind: "FESTIVAL",
          resourceKey: i.festivalSlug,
          beforeValue: {
            snapshot: i.snapshot,
            sourceId: i.sourceId,
            candidateId: i.candidate?.id ?? null,
            current: i.current,
            source: {
              url: i.source.url,
              strategies: i.source.strategies,
              parserKey: i.source.parserKey,
              refreshPolicy: i.source.refreshPolicy,
            },
          },
          afterValue: {
            ...receipt,
            facts: d.facts ?? {},
            sourceChange: d.source ?? null,
          },
          evidence: d.evidence,
          metadata: {
            issueId: i.issueId,
            reason: d.reason,
            providerPolicy: "explicit-refresh-only",
          },
        },
      });
      return receipt;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    },
  );
}
