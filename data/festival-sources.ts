import { festivals } from "./festivals.ts";
import type { FestivalSource, ParserStrategy, RefreshPolicy } from "../lib/ingestion/types.ts";

const bySlug = new Map(festivals.map((festival) => [festival.slug, festival]));
const catalogueEditionYear = 2027;
function source(festivalSlug: string, refreshPolicy: RefreshPolicy, strategies: ParserStrategy[] = ["json_ld_event", "html_fallback"]): FestivalSource {
  const festival = bySlug.get(festivalSlug);
  if (!festival) throw new Error(`Unknown festival source: ${festivalSlug}`);
  return { festivalSlug, url: festival.officialUrl, strategies, refreshPolicy, enabled: true, editionYear: festival.startDate ? Number(festival.startDate.slice(0, 4)) : catalogueEditionYear };
}
function manual(festivalSlug: string, reason: string): FestivalSource {
  return { ...source(festivalSlug, "weekly", ["manual_review"]), manualReviewReason: reason };
}
function retired(festivalSlug: string, reason: string): FestivalSource {
  return { ...source(festivalSlug, "archived", ["manual_review"]), enabled: false, manualReviewReason: reason };
}

// Explicit inventory: adding a festival to the catalogue requires adding its source here.
export const festivalSources: FestivalSource[] = [
  source("rock-am-ring", "daily"),
  source("rock-im-park", "daily"),
  source("wacken-open-air", "daily"),
  source("summer-breeze", "daily"),
  source("rockharz", "every_3_days"),
  source("hurricane", "every_3_days"),
  source("southside", "every_3_days"),
  manual("full-force", "official home page exposes a stale 2024 Event and no trustworthy current-edition dates"),
  source("hellfest", "every_3_days"),
  source("rock-en-seine", "weekly"),
  manual("motocultor", "official page renders current programme content without stable festival field markers"),
  source("eurockeennes", "weekly"),
  source("download", "weekly"),
  source("bloodstock", "daily"),
  source("reading", "weekly"),
  source("leeds", "weekly"),
  source("2000trees", "weekly", ["official_markup"]),
  source("graspop", "weekly"),
  source("rock-werchter", "weekly"),
  source("alcatraz", "weekly"),
  source("nova-rock", "daily"),
  source("frequency", "weekly"),
  source("rock-for-people", "daily"),
  source("brutal-assault", "weekly"),
  source("masters-of-rock", "every_3_days"),
  source("polandrock", "weekly"),
  source("mystic", "every_3_days"),
  source("rock-imperium", "daily"),
  manual("leyendas-del-rock", "official title confirms the edition year but exposes no trustworthy supported festival field"),
  source("resurrection-fest", "weekly"),
  manual("mad-cool", "official home page exposes promotional images but no stable current-edition field markup"),
  source("barcelona-rock-fest", "weekly"),
  manual("firenze-rocks", "official Live Nation shell does not expose a single authoritative festival date range"),
  source("idays", "daily"),
  source("rock-in-roma", "weekly"),
  source("alpen-flair", "every_3_days"),
  manual("pistoia-blues", "official page lists separate concert assets without an authoritative festival range"),
  source("pinkpop", "every_3_days", ["official_markup"]),
  source("roadburn", "every_3_days"),
  manual("dynamo-metal-fest", "official page metadata describes the site rather than a dated Festival Event"),
  source("greenfield", "every_3_days"),
  source("paleo", "weekly"),
  source("sweden-rock", "every_3_days"),
  source("tuska", "every_3_days", ["official_markup"]),
  source("tons-of-rock", "weekly"),
  source("inferno", "weekly"),
  manual("copenhell", "official home page has no stable authoritative date or location marker"),
  source("roskilde", "weekly"),
  manual("rockstadt", "official home page metadata has no authoritative current-edition date range"),
  source("tolminator", "every_3_days", ["official_markup", "html_fallback"]),
];
export function getFestivalSource(slug: string) { return festivalSources.find((item) => item.festivalSlug === slug); }
