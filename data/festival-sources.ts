import { festivals } from "./festivals.ts";
import type { FestivalSource, ParserStrategy, RefreshPolicy } from "../lib/ingestion/types.ts";

const bySlug = new Map(festivals.map((festival) => [festival.slug, festival]));
function source(festivalSlug: string, refreshPolicy: RefreshPolicy, strategies: ParserStrategy[] = ["json_ld_event", "html_fallback"]): FestivalSource {
  const festival = bySlug.get(festivalSlug);
  if (!festival) throw new Error(`Unknown festival source: ${festivalSlug}`);
  return { festivalSlug, url: festival.officialUrl, strategies, refreshPolicy, enabled: true };
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
  source("full-force", "weekly"),
  source("hellfest", "every_3_days"),
  source("rock-en-seine", "weekly"),
  source("motocultor", "weekly"),
  source("eurockeennes", "weekly"),
  source("download", "weekly"),
  source("bloodstock", "daily"),
  source("reading", "weekly"),
  source("leeds", "weekly"),
  source("2000trees", "weekly"),
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
  source("leyendas-del-rock", "daily"),
  source("resurrection-fest", "weekly"),
  source("mad-cool", "weekly"),
  source("barcelona-rock-fest", "weekly"),
  source("firenze-rocks", "weekly"),
  source("idays", "daily"),
  source("rock-in-roma", "weekly"),
  source("alpen-flair", "every_3_days"),
  source("pistoia-blues", "weekly"),
  source("pinkpop", "every_3_days"),
  source("roadburn", "every_3_days"),
  source("dynamo-metal-fest", "weekly"),
  source("greenfield", "every_3_days"),
  source("paleo", "weekly"),
  source("sweden-rock", "every_3_days"),
  source("tuska", "daily"),
  source("tons-of-rock", "weekly"),
  source("inferno", "weekly"),
  source("copenhell", "weekly"),
  source("roskilde", "weekly"),
  source("rockstadt", "every_3_days"),
  source("metaldays", "weekly"),
];
export function getFestivalSource(slug: string) { return festivalSources.find((item) => item.festivalSlug === slug); }
