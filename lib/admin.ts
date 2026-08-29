import type { Festival } from "@/data/festivals";

export type ReviewChange = {
  id: string;
  festival: string;
  field: string;
  current: string;
  detected: string;
  source: string;
  confidence: number;
  status: "pending" | "approved" | "rejected";
  conflict?: boolean;
};

export type ParserRun = {
  festival: string;
  source: string;
  status: "healthy" | "warning" | "failed";
  lastRun: string;
  durationMs: number;
  extracted: number;
  message: string;
};

export type AuditEntry = {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
};

export const reviewChanges: ReviewChange[] = [
  { id: "chg-1042", festival: "Wacken Open Air", field: "Lineup", current: "47 artists", detected: "49 artists (+ In Flames, Spiritbox)", source: "wacken.com/line-up", confidence: 98, status: "pending" },
  { id: "chg-1041", festival: "Rock am Ring", field: "Tickets URL", current: "tickets.rock-am-ring.com", detected: "eventim.de/rock-am-ring-2027", source: "rock-am-ring.com/tickets", confidence: 87, status: "pending", conflict: true },
  { id: "chg-1039", festival: "Hellfest Open Air", field: "Dates", current: "17–20 Jun 2027", detected: "18–20 Jun 2027", source: "hellfest.fr", confidence: 74, status: "pending", conflict: true },
];

export const parserRuns: ParserRun[] = [
  { festival: "Wacken Open Air", source: "JSON-LD", status: "healthy", lastRun: "2026-08-29 07:18 UTC", durationMs: 842, extracted: 49, message: "Schema validated; 2 new artists detected." },
  { festival: "Rock am Ring", source: "HTML fallback", status: "warning", lastRun: "2026-08-29 07:12 UTC", durationMs: 2310, extracted: 12, message: "Primary selector changed; fallback selector succeeded." },
  { festival: "Hellfest Open Air", source: "JSON-LD", status: "failed", lastRun: "2026-08-29 06:55 UTC", durationMs: 514, extracted: 0, message: "Invalid startDate/endDate range requires review." },
];

export const auditEntries: AuditEntry[] = [
  { id: "aud-884", at: "2026-08-29 07:22 UTC", actor: "system", action: "Detected change", target: "Wacken Open Air", detail: "2 lineup additions queued for review" },
  { id: "aud-883", at: "2026-08-29 07:14 UTC", actor: "editor@example.com", action: "Updated playlist", target: "Summer Breeze", detail: "Spotify playlist URL replaced" },
  { id: "aud-882", at: "2026-08-29 06:58 UTC", actor: "system", action: "Parser warning", target: "Rock am Ring", detail: "Switched to HTML fallback adapter" },
];

export type EditableFestival = Festival & { logoUrl?: string };
