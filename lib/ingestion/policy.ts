import {ROSKILDE_HOME,ROSKILDE_REVIEW} from "./adapters/roskilde.ts";
import { ROADBURN_ARTIST_REVIEW } from "./adapters/roadburn.ts";
import { ALPEN_ARTIST_REVIEW } from './adapters/alpen-flair.ts';
import { isCopenhellCurrentSource, COPENHELL_REVIEW } from "./adapters/copenhell-current.ts";
import { LEYENDAS_ARTIST_REVIEW, LEYENDAS_ORIGIN } from "./adapters/leyendas.ts";
import { isIdaysAnnouncement } from "./adapters/idays.ts";
import { MYSTIC_ARTIST_REVIEW } from "./adapters/mystic.ts";
import {isGraspopAnnouncement} from './adapters/graspop.ts';
import type { Festival } from "../domain/festival.ts";
import type { FestivalCandidate, IngestionResult } from "./types.ts";
import { INGESTION_SCHEMA_VERSION } from "./types.ts";
import { diffFestival } from "./diff.ts";

export function evaluateCandidate(current: Festival, candidate: FestivalCandidate): IngestionResult {
  // An incomplete I-Days announcement cannot downgrade a verified full bill.
  if (candidate.festivalSlug === "idays" && candidate.artistListMode === "additive" && candidate.status === "partial" && current.status === "confirmed") candidate = { ...candidate, status: undefined };
  // Additive first-wave pages do not redefine independently reviewed billing.
  // Scope each reconciliation to its own registered source and edition.
  const rockstadtAnnouncement = current.slug === "rockstadt" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://bilete.rockstadtextremefest.ro/bilete-rockstadt-fest-2027-129242/" &&
    current.editionYear === 2027 && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === 2027 && candidate.artistListMode === "additive" &&
    candidate.evidence.some(item => item.field === "lineup");
  const rockharzGrid = current.slug === "rockharz" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://www.rockharz-festival.com/bands" && current.editionYear === 2027 &&
    candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === 2027 &&
    candidate.artistListMode === "additive" && candidate.evidence.some(e => e.field === "lineup");
  const reviewedNames = new Set([...current.headliners, ...current.lineup].map(name => name.toLocaleLowerCase()));
  const reviewedHeadliners = new Set(current.headliners.map(name => name.toLocaleLowerCase()));
  const reconcileBilling = rockstadtAnnouncement || rockharzGrid;
  const warnings = candidate.warnings.filter(warning => !(candidate.lineup?.every(name => reviewedNames.has(name.toLocaleLowerCase())) &&
    ((rockstadtAnnouncement && warning === "Agent review required before lineup-triggered provider activity") ||
     (rockharzGrid && warning.startsWith("New Rockharz captions are provisional and require independent artist review:")))));
  const effective = reconcileBilling ? { ...candidate,
    ...(rockstadtAnnouncement && current.status === "confirmed" ? { status: current.status } : {}),
    lineup: candidate.lineup?.filter(name => !reviewedHeadliners.has(name.toLocaleLowerCase())),
    warnings } : candidate;
  const changes = diffFestival(current, effective);
  const unchangedMystic = current.slug === "mystic" && candidate.festivalSlug === current.slug &&
    candidate.sourceUrl === "https://www.mysticfestival.pl/" && candidate.lineupScope === "announcement" &&
    candidate.headliners === undefined && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === current.editionYear && candidate.evidence.some(e => e.field === "lineup") &&
    !changes.some(change => ["lineup", "headliners"].includes(change.field));
  const unchangedLeyendas = candidate.festivalSlug === "leyendas-del-rock" && current.slug === candidate.festivalSlug &&
    candidate.sourceUrl === LEYENDAS_ORIGIN + "/" && candidate.artistListMode === "additive" &&
    candidate.lineupScope === "announcement" && candidate.observedEditionYears.length === 1 &&
    candidate.observedEditionYears[0] === current.editionYear && !changes.some(change => ["lineup", "headliners"].includes(change.field));
  // Nova Rock's provider gate protects actual artist/billing changes, not
  // unchanged verified cards or independent ticket metadata refreshes.
  const unchangedNovaLineup = candidate.festivalSlug === "nova-rock" && !changes.some(change => ["lineup", "headliners"].includes(change.field));
  const unchangedRoadburn = candidate.festivalSlug === "roadburn" && !changes.some(change => ["lineup", "headliners"].includes(change.field));
  const unchangedCopenhell = candidate.festivalSlug === "copenhell" && current.slug === candidate.festivalSlug &&
    current.editionYear === candidate.observedEditionYears[0] && candidate.observedEditionYears.length === 1 &&
    isCopenhellCurrentSource({ festivalSlug: candidate.festivalSlug, url: candidate.sourceUrl, editionYear: current.editionYear, strategies: ["official_markup"], enabled: true, refreshPolicy: "weekly" }) &&
    !changes.some(change => ["lineup", "headliners"].includes(change.field));
  const unchangedRoskilde = current.slug === "roskilde" && candidate.festivalSlug === current.slug && candidate.sourceUrl === ROSKILDE_HOME && candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === current.editionYear && candidate.artistListMode === "additive" && !changes.some(c => ["lineup","headliners"].includes(c.field));
  const reviewReasons = new Set(warnings.filter(warning =>
    !(unchangedRoskilde && warning === ROSKILDE_REVIEW) &&
    !(unchangedMystic && warning === MYSTIC_ARTIST_REVIEW) &&
    !(unchangedRoadburn && warning === ROADBURN_ARTIST_REVIEW) &&
    !(candidate.festivalSlug === "alpen-flair" && !changes.some(change => ["lineup", "headliners"].includes(change.field)) && warning === ALPEN_ARTIST_REVIEW) &&
    !(unchangedCopenhell && warning === COPENHELL_REVIEW) &&
    !(unchangedLeyendas && warning === LEYENDAS_ARTIST_REVIEW) &&
    !(unchangedNovaLineup && warning === "Agent review required before lineup-triggered provider activity")));
  // Dynamo/Tons of Rock/Heavy Week-End retain their separate provider policy.
  if (["dynamo-metal-fest", "tons-of-rock", "heavy-weekend", "barcelona-rock-fest"].includes(current.slug) && changes.some(change => change.kind === "artist_added" || change.kind === "headliner_added"))
    reviewReasons.add("Agent review required before lineup-triggered provider activity");
  // Verified official RFP announcements may use normal publication/playlist
  // processing. A successful parse alone is not enough: keep provenance,
  // edition, additive semantics and ambiguous billing checks.
  if (current.slug === "rock-for-people" && changes.some(change =>
    change.kind === "artist_added" || change.kind === "headliner_added")) {
    const official = candidate.sourceUrl === "https://rockforpeople.cz/" &&
      candidate.festivalSlug === current.slug && candidate.artistListMode === "additive" &&
      candidate.lineupScope === "announcement" && candidate.observedEditionYears.length === 1 &&
      candidate.observedEditionYears[0] === current.editionYear &&
      changes.filter(change => ["lineup", "headliners"].includes(change.field)).every(change =>
        ["artist_added", "headliner_added"].includes(change.kind) &&
        candidate.evidence.some(e => e.field === change.field && e.sourceUrl === candidate.sourceUrl));
    if (!official) reviewReasons.add("Rock for People additions require verified current official announcement evidence");
    const supports = new Set([...current.lineup, ...(candidate.lineup ?? [])].map(name => name.toLocaleLowerCase()));
    if ([...current.headliners, ...(candidate.headliners ?? [])].some(name => supports.has(name.toLocaleLowerCase())))
      reviewReasons.add("Rock for People billing changes require reviewed reclassification");
  }
  if (candidate.festivalSlug === "impericon" && candidate.sourceUrl === "https://www.impericon.com/pages/festival" &&
    candidate.headliners?.some(name => current.lineup.some(old => old.toLowerCase() === name.toLowerCase())))
    reviewReasons.add("Impericon billing promotion requires reviewed reclassification");
  if(candidate.festivalSlug==='graspop' && changes.some(change=>['lineup','headliners'].includes(change.field))) {
    if(!isGraspopAnnouncement(candidate,current.editionYear ?? Number(current.startDate?.slice(0,4))))reviewReasons.add('Graspop additions require verified current official announcement evidence');
    if(candidate.headliners?.some(name=>current.lineup.some(old=>old.toLowerCase()===name.toLowerCase())) || candidate.lineup?.some(name=>[...current.headliners,...(candidate.headliners ?? [])].some(old=>old.toLowerCase()===name.toLowerCase())))reviewReasons.add('Graspop billing changes require reviewed reclassification');
  }
  if (candidate.festivalSlug !== current.slug) reviewReasons.add("Candidate slug does not match the current festival");
  if (candidate.festivalSlug === "idays" && changes.some(change => ["lineup", "headliners"].includes(change.field))) {
    if (!isIdaysAnnouncement(candidate, current.editionYear)) reviewReasons.add("I-Days additions require verified official edition evidence");
    const names = (values: string[] = []) => new Set(values.map(name => name.toLocaleLowerCase()));
    const heads = names([...current.headliners, ...(candidate.headliners ?? [])]);
    const support = names([...current.lineup, ...(candidate.lineup ?? [])]);
    if ([...heads].some(name => support.has(name))) reviewReasons.add("I-Days billing changes require reviewed reclassification");
  }
  const catalogueYear = current.editionYear ?? (current.startDate ? Number(current.startDate.slice(0, 4)) : undefined);
  const mismatchedYears = catalogueYear ? candidate.observedEditionYears.filter((year) => year !== catalogueYear) : [];
  if (mismatchedYears.length) reviewReasons.add(`Candidate edition ${mismatchedYears.join(", ")} does not match catalogue edition ${catalogueYear}`);
  if (candidate.lineup && candidate.lineup.length > 0 && !catalogueYear) reviewReasons.add("Catalogue edition year is unknown; lineup requires review");
  if (candidate.lineup && candidate.lineup.length > 0 && candidate.observedEditionYears.length === 0) reviewReasons.add("Lineup edition could not be verified against the catalogue year");
  if (candidate.lineup && candidate.lineup.length === 0 && current.lineup.length > 0) reviewReasons.add("A non-empty lineup cannot be replaced by an empty lineup");
  changes.filter((change) => change.reviewRequired).forEach((change) => reviewReasons.add(change.reason || `${change.kind} requires review`));
  return { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: current.slug, sourceUrl: candidate.sourceUrl, fetchedAt: candidate.fetchedAt, changes, candidate: effective, publishable: changes.length > 0 && reviewReasons.size === 0, reviewReasons: [...reviewReasons] };
}
