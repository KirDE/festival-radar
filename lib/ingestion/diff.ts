import type { Festival } from "../../data/festivals.ts";
import type { FestivalCandidate, FestivalChange } from "./types.ts";

function scalarChange(changes: FestivalChange[], field: "startDate" | "endDate" | "city" | "ticketsUrl" | "status", before: string | undefined, after: string | undefined) {
  if (after === undefined || before === after) return;
  const kind = field === "city" ? "city_changed" : field === "ticketsUrl" ? "tickets_changed" : field === "status" ? "status_changed" : "date_changed";
  changes.push({ kind, field, before, after, reviewRequired: field === "startDate" || field === "endDate" });
}

function listChanges(changes: FestivalChange[], field: "lineup" | "headliners", before: string[], after: string[] | undefined) {
  if (!after) return;
  const oldNames = new Map(before.map((name) => [name.toLocaleLowerCase(), name]));
  const newNames = new Map(after.map((name) => [name.toLocaleLowerCase(), name]));
  for (const [key, name] of newNames) if (!oldNames.has(key)) changes.push({ kind: field === "headliners" ? "headliner_added" : "artist_added", field, after: name, reviewRequired: false });
  for (const [key, name] of oldNames) if (!newNames.has(key)) changes.push({ kind: field === "headliners" ? "headliner_removed" : "artist_removed", field, before: name, reviewRequired: true, reason: "Removals require confirmation" });
}

function operationalChanges(changes: FestivalChange[], current: Festival, candidate: FestivalCandidate) {
  if (candidate.ticketStatus && candidate.ticketStatus !== current.ticketStatus) {
    changes.push({ kind: "ticket_status_changed", field: "ticketStatus", before: current.ticketStatus, after: candidate.ticketStatus, reviewRequired: false });
  }
  if (candidate.timetable?.length && !current.timetable?.length) {
    changes.push({ kind: "timetable_published", field: "timetable", after: `${candidate.timetable.length}`, reviewRequired: true, reason: "Timetables require provenance-aware reviewed import" });
  }
}

export function diffFestival(current: Festival, candidate: FestivalCandidate): FestivalChange[] {
  const changes: FestivalChange[] = [];
  scalarChange(changes, "startDate", current.startDate, candidate.startDate);
  scalarChange(changes, "endDate", current.endDate, candidate.endDate);
  scalarChange(changes, "city", current.city, candidate.city);
  scalarChange(changes, "ticketsUrl", current.ticketsUrl, candidate.ticketsUrl);
  scalarChange(changes, "status", current.status, candidate.status);
  listChanges(changes, "headliners", current.headliners, candidate.headliners);
  listChanges(changes, "lineup", current.lineup, candidate.lineup);
  operationalChanges(changes, current, candidate);
  return changes;
}
