import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

type JsonLd = Record<string, unknown>;

function records(value: unknown): JsonLd[] {
  if (Array.isArray(value)) return value.flatMap(records);
  if (!value || typeof value !== "object") return [];
  const record = value as JsonLd;
  return [record, ...records(record["@graph"])];
}

function eventRecords(html: string): { event: JsonLd; excerpt: string }[] {
  const events: { event: JsonLd; excerpt: string }[] = [];
  const scriptPattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const source = match[1].trim();
    if (!source) continue;
    try {
      const parsed = JSON.parse(source);
      for (const record of records(parsed)) {
        const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
        if (types.some((type) => typeof type === "string" && type.toLowerCase().endsWith("event"))) {
          events.push({ event: record, excerpt: source.slice(0, 500) });
        }
      }
    } catch {
      continue;
    }
  }
  return events;
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value === "object" && typeof (value as JsonLd).name === "string") return ((value as JsonLd).name as string).trim() || undefined;
  return undefined;
}

function date(value: unknown): string | undefined {
  const valueText = text(value);
  if (!valueText) return undefined;
  const plainDate = valueText.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (plainDate) return plainDate;
  const parsed = new Date(valueText);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString().slice(0, 10);
}

function city(location: unknown): string | undefined {
  if (!location || typeof location !== "object") return undefined;
  const address = (location as JsonLd).address;
  if (typeof address === "string") return undefined;
  if (address && typeof address === "object") return text((address as JsonLd).addressLocality);
  return undefined;
}

function names(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  const result = [...new Set(values.map(text).filter((name): name is string => Boolean(name)))];
  return result.length > 0 ? result : undefined;
}

function ticketUrl(offers: unknown): string | undefined {
  const values = Array.isArray(offers) ? offers : [offers];
  for (const offer of values) {
    if (typeof offer === "string" && /^https:\/\//.test(offer)) return offer;
    if (offer && typeof offer === "object") {
      const url = text((offer as JsonLd).url);
      if (url && /^https:\/\//.test(url)) return url;
    }
  }
  return undefined;
}

function ticketStatus(offers: unknown): FestivalCandidate["ticketStatus"] {
  const values = Array.isArray(offers) ? offers : [offers];
  const availability = values.flatMap((offer) => offer && typeof offer === "object" ? [text((offer as JsonLd).availability)?.toLowerCase()] : []).filter(Boolean);
  if (availability.some((value) => value?.includes("soldout") || value?.includes("outofstock"))) return "unavailable";
  if (availability.some((value) => value?.includes("limitedavailability") || value?.includes("limited"))) return "low";
  if (availability.some((value) => value?.includes("instock") || value?.includes("preorder") || value?.includes("presale"))) return "available";
  return undefined;
}

function timetable(value: unknown): FestivalCandidate["timetable"] {
  const result = records(value).flatMap((entry) => {
    const artist = text(entry.performer) || text(entry.name);
    const startDate = text(entry.startDate);
    if (!artist || !startDate) return [];
    const parsed = new Date(startDate);
    if (Number.isNaN(parsed.valueOf())) return [];
    return [{ date: parsed.toISOString().slice(0, 10), start: parsed.toISOString().slice(11, 16), stage: text(entry.location) || "TBA", artist }];
  });
  return result.length ? result : undefined;
}

export function extractJsonLdCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const matches = eventRecords(html);
  const selected = matches[0];
  const candidate: FestivalCandidate = {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    festivalSlug: source.festivalSlug,
    sourceUrl: source.url,
    fetchedAt,
    evidence: [],
    warnings: [],
  };

  if (!selected) {
    candidate.warnings.push("No JSON-LD Event was found");
    return candidate;
  }

  const fields = {
    startDate: date(selected.event.startDate),
    endDate: date(selected.event.endDate),
    city: city(selected.event.location),
    lineup: names(selected.event.performer),
    ticketsUrl: ticketUrl(selected.event.offers),
    ticketStatus: ticketStatus(selected.event.offers),
    timetable: timetable(selected.event.subEvent),
  };

  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field: field as FieldEvidence["field"], sourceUrl: source.url, observedAt: fetchedAt, excerpt: selected.excerpt });
  }

  const eventStatus = text(selected.event.eventStatus)?.toLowerCase();
  if (eventStatus?.includes("cancelled") || eventStatus?.includes("postponed")) {
    candidate.warnings.push(`Official event status requires review: ${text(selected.event.eventStatus)}`);
  }
  if (matches.length > 1) candidate.warnings.push(`Multiple JSON-LD Events found (${matches.length}); the first event was selected`);
  if (candidate.evidence.length === 0) candidate.warnings.push("JSON-LD Event did not contain supported festival fields");
  return candidate;
}
