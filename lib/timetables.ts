import { z } from "zod";
import type { Festival, TimetableEntry } from "../data/festivals.ts";

export const timetableEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }, "date must be a real calendar date"),
  stage: z.string().trim().min(1).max(100),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  artist: z.string().trim().min(1).max(200),
  timeZone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "timeZone must be a valid IANA identifier"),
  status: z.enum(["scheduled", "cancelled"]),
  sourceUrl: z.string().url().refine((value) => value.startsWith("https://"), "sourceUrl must use HTTPS"),
  observedAt: z.string().datetime({ offset: true }),
});

export const timetableDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  festivals: z.record(z.string(), z.array(timetableEntrySchema)),
});

export type TimetableDocument = z.infer<typeof timetableDocumentSchema>;
export type TimetableConflict = { date: string; stage: string; start: string; artists: string[] };
export type TimetableStage = { stage: string; entries: TimetableEntry[] };
export type TimetableDay = { date: string; stages: TimetableStage[] };

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function findTimetableConflicts(entries: TimetableEntry[]): TimetableConflict[] {
  const slots = new Map<string, Set<string>>();
  for (const entry of entries.filter(({ status }) => status === "scheduled")) {
    const key = `${entry.date}\u0000${entry.stage.toLocaleLowerCase()}\u0000${entry.start}`;
    const artists = slots.get(key) ?? new Set<string>();
    artists.add(entry.artist);
    slots.set(key, artists);
  }
  return [...slots.entries()].filter(([, artists]) => artists.size > 1).map(([key, artists]) => {
    const [date, stage, start] = key.split("\u0000");
    return { date, stage, start, artists: [...artists].sort(collator.compare) };
  });
}

export function groupTimetable(entries: TimetableEntry[]): TimetableDay[] {
  const days = new Map<string, Map<string, TimetableEntry[]>>();
  for (const entry of entries) {
    const stages = days.get(entry.date) ?? new Map<string, TimetableEntry[]>();
    const stageEntries = stages.get(entry.stage) ?? [];
    stageEntries.push(entry);
    stages.set(entry.stage, stageEntries);
    days.set(entry.date, stages);
  }
  return [...days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, stages]) => ({
    date,
    stages: [...stages.entries()].sort(([left], [right]) => collator.compare(left, right)).map(([stage, stageEntries]) => ({
      stage,
      entries: stageEntries.sort((left, right) => left.start.localeCompare(right.start) || collator.compare(left.artist, right.artist)),
    })),
  }));
}

export function validateFestivalTimetable(festival: Festival, entries: TimetableEntry[]) {
  const parsed = entries.map((entry) => timetableEntrySchema.parse(entry));
  const errors: string[] = [];
  const identities = new Set<string>();
  for (const entry of parsed) {
    if (festival.startDate && entry.date < festival.startDate) errors.push(`${entry.artist}: ${entry.date} precedes festival start`);
    if (festival.endDate && entry.date > festival.endDate) errors.push(`${entry.artist}: ${entry.date} follows festival end`);
    const source = new URL(entry.sourceUrl);
    const official = new URL(festival.officialUrl);
    if (source.hostname !== official.hostname) {
      errors.push(`${entry.artist}: source is not under the festival official URL`);
    }
    const identity = [entry.date, entry.stage.toLocaleLowerCase(), entry.start, entry.artist.toLocaleLowerCase(), entry.status].join("\u0000");
    if (identities.has(identity)) errors.push(`${entry.artist}: duplicate timetable row`);
    identities.add(identity);
  }
  for (const conflict of findTimetableConflicts(parsed)) errors.push(`conflict at ${conflict.date} ${conflict.start} ${conflict.stage}: ${conflict.artists.join(", ")}`);
  if (errors.length) throw new Error(errors.join("\n"));
  return parsed;
}
