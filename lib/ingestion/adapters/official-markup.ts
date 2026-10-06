import type { FestivalCandidate, FestivalSource, FieldEvidence } from "../types.ts";
import { copenhell } from "./copenhell.ts";
import { INGESTION_SCHEMA_VERSION } from "../types.ts";

type AdapterResult = { editionYear?: number; startDate?: string; endDate?: string; city?: string; headliners?: string[]; lineup?: string[]; status?: FestivalCandidate["status"]; excerpt: string; warning?: string };

const months: Record<string, string> = { januari: "01", februari: "02", maart: "03", april: "04", mei: "05", juni: "06", juli: "07", augustus: "08", september: "09", oktober: "10", november: "11", december: "12" };
const pad = (value: string) => value.padStart(2, "0");

function decode(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decode(match[1] ?? match[2] ?? "") : undefined;
}

function ringAndPark(html: string): AdapterResult | undefined {
  const date = html.match(/\b(\d{1,2})\s*\.?\s*(?:[-–—]|bis|to)\s*(\d{1,2})\s*\.?\s+(juni|june)\s+(20\d{2})\b/i);
  if (!date) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = date[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/(?:^|\/)line-up\/[^/]+\/?$/i.test(pathname)) continue;

    const text = decode(match[2].replace(/<[^>]+>/g, " "));
    const image = match[2].match(/<img\b[^>]*>/i)?.[0];
    const imageName = image ? attribute(image, "title") ?? attribute(image, "alt")?.replace(/^Logo\s+/i, "") : undefined;
    const name = (text || imageName || "").trim();
    if (!name) continue;

    const dayStart = html.lastIndexOf('<article class="lineup-day"', match.index);
    const context = html.slice(dayStart < 0 ? 0 : dayStart, match.index);
    const labels = [...context.matchAll(/\baria-label\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)];
    const group = labels.at(-1)?.[1] ?? labels.at(-1)?.[2] ?? "";
    const target = /^headliner$/i.test(group) ? headliners : lineup;
    if (![...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) target.push(name);
    if (excerpt === date[0]) excerpt = match[0].slice(0, 500);
  }
  if (headliners.length + lineup.length === 0) return undefined;
  return {
    startDate: `${date[4]}-06-${pad(date[1])}`,
    endDate: `${date[4]}-06-${pad(date[2])}`,
    headliners,
    lineup,
    excerpt,
  };
}

function fkpArtistName(value: string): string {
  if (value !== value.toLocaleUpperCase()) return value;
  const smallWords = new Set(["a", "and", "de", "for", "of", "the"]);
  return value.split(/\s+/).map((word, index) => {
    if (["I", "MGK", "VNV"].includes(word)) return word;
    return word.split("-").map((part) => {
      const lower = part.toLocaleLowerCase();
      return index > 0 && smallWords.has(lower) ? lower : part ? `${part[0].toLocaleUpperCase()}${part.slice(1).toLocaleLowerCase()}` : part;
    }).join("-");
  }).join(" ");
}

function greenfield(html: string): AdapterResult | undefined {
  const date = html.match(/\b(\d{1,2})\s*\.\s*[-–—]\s*(\d{1,2})\s*\.\s+Juni\s+(20\d{2})\b/i);
  if (!date) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = date[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    const classes = attribute(match[1], "class")?.split(/\s+/) ?? [];
    if (!href || !classes.includes("artist-item")) continue;

    let pathname: string;
    try {
      pathname = new URL(href, "https://greenfieldfestival.ch/").pathname;
    } catch {
      continue;
    }
    if (!/^\/line-up\/[^/]+\/?$/i.test(pathname)) continue;

    const name = fkpArtistName(decode(match[2].replace(/<[^>]+>/g, " ")));
    if (!name || [...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    const target = classes.includes("h1") ? headliners : classes.includes("h3") ? lineup : undefined;
    if (!target) continue;
    target.push(name);
    if (excerpt === date[0]) excerpt = `${date[0]} ${match[0]}`;
  }
  if (headliners.length === 0 || lineup.length === 0) return undefined;
  return {
    startDate: `${date[3]}-06-${pad(date[1])}`,
    endDate: `${date[3]}-06-${pad(date[2])}`,
    headliners,
    lineup,
    status: "partial",
    excerpt,
  };
}

function rockForPeople(html: string): AdapterResult | undefined {
  const edition = html.match(/<img\b[^>]*(?:src\s*=\s*["'][^"']*date-topbar-(20\d{2})\.svg["'][^>]*|alt\s*=\s*["']Rock for People\s+(20\d{2})\s+datum["'][^>]*)>/i);
  const editionYear = Number(edition?.[1] ?? edition?.[2]);
  if (!Number.isInteger(editionYear)) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = edition?.[0] ?? "";
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    const classes = attribute(match[1], "class")?.split(/\s+/) ?? [];
    if (!href || !classes.includes("card") || !classes.includes("card--lineup")) continue;

    let pathname: string;
    try {
      pathname = new URL(href, "https://rockforpeople.cz/").pathname;
    } catch {
      continue;
    }
    if (!/^\/lineup\/[^/]+\/?$/i.test(pathname)) continue;

    const heading = match[2].match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
    const name = heading ? decode(heading.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, " ").replace(/<[^>]+>/g, " ")) : "";
    if (!name || [...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    const target = classes.includes("yellow") ? headliners : classes.includes("white") ? lineup : undefined;
    if (!target) continue;
    target.push(name);
    if (excerpt === edition?.[0]) excerpt = `${edition?.[0]} ${match[0]}`;
  }
  if (headliners.length === 0 || lineup.length === 0) return undefined;
  return { editionYear, headliners, lineup, status: "partial", excerpt };
}

function meraLuna(html: string): AdapterResult | undefined {
  const edition = html.match(/\bLine-Up\s+(20\d{2})\b/i);
  if (!edition) return undefined;
  const date = [...html.matchAll(/\b(\d{1,2})\s*\.\s*(?:&amp;|&|[-–—])\s*(\d{1,2})\s*\.\s+August\s+(20\d{2})\b/gi)]
    .find((candidate) => candidate[3] === edition[1]);
  if (!date) return undefined;

  const lineup: string[] = [];
  let excerpt = edition[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/^\/line-up\/act\/[^/]+\/?$/i.test(pathname)) continue;

    const blockStart = html.lastIndexOf("<lineup-block", match.index);
    const blockEnd = html.lastIndexOf("</lineup-block>", match.index);
    if (blockStart < 0 || blockStart < blockEnd) continue;

    const name = fkpArtistName(decode(match[2].replace(/<[^>]+>/g, " ")));
    if (!name || lineup.some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    lineup.push(name);
    if (excerpt === edition[0]) excerpt = `${edition[0]} ${match[0]}`;
  }
  if (lineup.length === 0) return undefined;
  return {
    startDate: `${date[3]}-08-${pad(date[1])}`,
    endDate: `${date[3]}-08-${pad(date[2])}`,
    lineup,
    excerpt,
  };
}

function fkpLineup(html: string): AdapterResult | undefined {
  const edition = html.match(/\bLine-Up\s+(20\d{2})\b/i);
  const date = html.match(/\b(\d{1,2})\s*\.\s*(?:[-–—]\s*)?(\d{1,2})\s*\.\s+Juni\s+(20\d{2})\b/i);
  if (!edition || !date || edition[1] !== date[3]) return undefined;

  const headliners: string[] = [];
  const lineup: string[] = [];
  let excerpt = edition[0];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    let pathname: string;
    try {
      pathname = new URL(href, "https://festival.invalid/").pathname;
    } catch {
      continue;
    }
    if (!/^\/line-up\/act\/[^/]+\/?$/i.test(pathname)) continue;

    const blockStart = html.lastIndexOf("<lineup-block", match.index);
    const blockEnd = html.lastIndexOf("</lineup-block>", match.index);
    if (blockStart < 0 || blockStart < blockEnd) continue;
    const blockTagEnd = html.indexOf(">", blockStart);
    if (blockTagEnd < blockStart || blockTagEnd > match.index) continue;
    const blockTag = html.slice(blockStart, blockTagEnd + 1);

    const rawName = decode(match[2].replace(/<[^>]+>/g, " "));
    const name = fkpArtistName(rawName);
    if (!name || [...headliners, ...lineup].some((existing) => existing.localeCompare(name, undefined, { sensitivity: "base" }) === 0)) continue;
    const target = /block--size-XXL\b/i.test(blockTag) ? headliners : lineup;
    target.push(name);
    if (excerpt === edition[0]) excerpt = `${edition[0]} ${match[0]}`;
  }
  if (headliners.length === 0 || lineup.length === 0) return undefined;
  return {
    startDate: `${date[3]}-06-${pad(date[1])}`,
    endDate: `${date[3]}-06-${pad(date[2])}`,
    headliners,
    lineup,
    excerpt,
  };
}

function pinkpop(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s*[•·]\s*(\d{1,2})\s*[•·]\s*(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(20\d{2})/i);
  if (!date) return undefined;
  const location = html.match(/class=["'][^"']*location[^"']*["'][^>]*>[\s\S]{0,200}?<strong[^>]*>[^<]+<\/strong>\s*([^<]+)/i);
  return { startDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[1])}`, endDate: `${date[5]}-${months[date[4].toLowerCase()]}-${pad(date[3])}`, city: location?.[1].trim(), excerpt: date[0] };
}

function tuska(html: string): AdapterResult | undefined {
  const date = html.match(/Tuska Festival\s*[-–—]\s*(\d{1,2})\.[–-](\d{1,2})\.(\d{1,2})\.(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[4]}-${pad(date[3])}-${pad(date[1])}`, endDate: `${date[4]}-${pad(date[3])}-${pad(date[2])}`, excerpt: date[0] };
}

function tonsOfRock(html: string): AdapterResult | undefined {
  const edition = html.match(/FØRSTE ARTISTER TIL TONS OF ROCK\s+(20\d{2})\s+ER KLARE/iu);
  const date = html.match(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\.\s*juni\s+(20\d{2})\b/iu);
  const announced = html.match(/de første\s+(\d+)\s+artistene til Tons of Rock\s+(20\d{2})\s+er klare/iu);
  const list = html.match(/Her er alle artistene for årets første slipp:\s*<\/p>\s*<p>([\s\S]*?)<\/p>/iu);
  if (!edition || !date || !announced || !list || edition[1] !== date[3] || edition[1] !== announced[2]) return undefined;

  const lineup = list[1]
    .replace(/<br\s*\/?\s*>/giu, "\n")
    .split("\n")
    .map((name) => decode(name.replace(/<[^>]+>/g, " ")))
    .filter(Boolean)
    .map((name) => name === "Motionless in white" ? "Motionless in White" : name);
  if (lineup.length !== Number(announced[1]) || new Set(lineup.map((name) => name.toLocaleLowerCase())).size !== lineup.length) return undefined;

  return {
    startDate: `${date[3]}-06-${pad(date[1])}`,
    endDate: `${date[3]}-06-${pad(date[2])}`,
    lineup,
    excerpt: `${edition[0]} ${announced[0]} ${list[0]}`,
  };
}

function midgardsblot(html: string): AdapterResult | undefined {
  const date = html.match(/\b(\d{1,2})\s*\.\s*[-–—]\s*(\d{1,2})\s*\.\s+August\s+(20\d{2})\s*\|\s*Borre\s+Norway\b/i);
  if (!date) return undefined;
  return {
    startDate: `${date[3]}-08-${pad(date[1])}`,
    endDate: `${date[3]}-08-${pad(date[2])}`,
    city: "Borre",
    excerpt: date[0],
  };
}

function dynamoMetalFest(html: string, source: FestivalSource): AdapterResult | undefined {
  // This exact article, not homepage navigation, SEO metadata or past posts.
  if (source.editionYear !== 2027 || source.url !== "https://dynamo-metalfest.nl/first-names-dmf-27/") return undefined;
  const title = decode(html.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] ?? "");
  const canonical = html.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0];
  if (title !== "FIRST NAMES DMF 27 - Dynamo Metalfest" || !canonical || attribute(canonical, "href") !== source.url) return undefined;
  const widget = html.match(/<div\b[^>]*\bdata-widget_type=["']theme-post-content\.default["'][^>]*>\s*<div class=["']elementor-widget-container["']>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1];
  if (!widget || !/<h1\b[^>]*>\s*FIRST NAMES DMF 27\s*<\/h1>/i.test(html.slice(0, html.indexOf(widget)))) return undefined;
  const paragraphs = [...widget.matchAll(/<p\b[^>]*class=["']wp-block-paragraph["'][^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]);
  if (paragraphs.length < 4 || !/^Here is the complete overview of the first names announced for Dynamo Metalfest 2027!/i.test(decode(paragraphs[0].replace(/<[^>]*>/g, " ")))) return undefined;
  const artistBlock = paragraphs[1].match(/^\s*<strong>([\s\S]*?)<\/strong>\s*$/i)?.[1];
  if (!artistBlock || !/^And this is only the beginning\.$/i.test(decode(paragraphs[2].replace(/<[^>]*>/g, " ")))) return undefined;
  const rawNames = artistBlock.split(/<br\s*\/?\s*>/i);
  if (rawNames.length !== 9 || rawNames.some((name) => /<[^>]*>/.test(name))) return undefined;
  const lineup: string[] = [];
  for (const raw of rawNames) {
    const label = decode(raw).replace(/[’‘]/g, "'");
    // Strip only the three published performance labels, never arbitrary suffixes.
    const name = label.replace(/^CAVALERA\s+[–—-]\s+CHAOS A\.D\.$/i, "CAVALERA")
      .replace(/^MADBALL\s+[–—-]\s+D\.O\.A\. '95 SET$/i, "MADBALL")
      .replace(/^I AM MORBID\s+[–—-]\s+D\.O\.A\. '91$/i, "I AM MORBID");
    if (!/^[A-Z][A-Z\s]+$/.test(name) || name.length > 90 || /\b(?:19|20)\d{2}\b/.test(name)) return undefined;
    const artist = name === "LEFT TO SUFFER" ? "Left to Suffer" : fkpArtistName(name);
    if (lineup.some((existing) => existing.toLowerCase() === artist.toLowerCase())) return undefined;
    lineup.push(artist);
  }
  const statement = decode(paragraphs[3].replace(/<[^>]*>/g, " "));
  const dates = statement.match(/^Three days of metal return to Eindhoven on August (\d{1,2}), (\d{1,2}) & (\d{1,2}), (2027)\.$/i);
  if (!dates) return undefined;
  const days = dates.slice(1, 4).map(Number);
  if (days[0] < 1 || days[2] > 31 || days[1] !== days[0] + 1 || days[2] !== days[1] + 1) return undefined;
  return { editionYear: 2027, startDate: "2027-08-" + pad(dates[1]), endDate: "2027-08-" + pad(dates[3]),
    city: "Eindhoven", lineup, excerpt: statement + " First names: " + rawNames.map(decode).join(", ") };
}

const jeraMonths = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

// The title is the edition anchor on both pages. The info page must independently
// agree on all three dates before proposing a date change for human review.
function jeraTitleDates(title: string): { page: string; month: number; days: number[]; startDate: string; endDate: string } | undefined {
  const match = title.match(/^(Information|Line up) - Jera On Air 2027 - ([A-Za-z]+) (\d{1,2})-(\d{1,2})-(\d{1,2})$/i);
  if (!match) return undefined;
  const month = jeraMonths.indexOf(match[2].toLowerCase()) + 1;
  const days = match.slice(3).map(Number);
  if (!month || days.some((day) => day < 1 || day > 31)) return undefined;
  const dates = days.map((day) => new Date(Date.UTC(2027, month - 1, day)));
  if (dates.some((date) => date.getUTCMonth() !== month - 1) || dates[1].getTime() - dates[0].getTime() !== 86400000 || dates[2].getTime() - dates[1].getTime() !== 86400000) return undefined;
  return { page: match[1].toLowerCase(), month, days, startDate: dates[0].toISOString().slice(0, 10), endDate: dates[2].toISOString().slice(0, 10) };
}

// The two exact official URLs are independent DB sources. Ignore navigation,
// footer, artist popups, and archived editions.
function jeraOnAir(html: string, source: FestivalSource): AdapterResult | undefined {
  if (source.editionYear !== 2027) return undefined;
  let page: URL;
  try { page = new URL(source.url); } catch { return undefined; }
  if (page.origin !== "https://www.jeraonair.nl" || page.search || page.hash) return undefined;
  const path = page.pathname.replace(/\/?$/, "/");
  if (path !== "/en/info/" && path !== "/en/line-up/") return undefined;

  const title = decode(html.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1] ?? "");
  const titleDates = jeraTitleDates(title);
  if (!titleDates) return undefined;
  if (path === "/en/info/") {
    if (titleDates.page !== "information") return undefined;
    const general = html.match(/<div class="text">\s*<h2>GENERAL<\/h2>\s*<p>[\s\S]*?<\/p>\s*<p>([\s\S]*?)<\/p>/i)?.[1];
    const statement = general && decode(general.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " "));
    const dates = statement?.match(/\b2027 is edition #33 of Jera On Air and will take place on (\d{1,2}), (\d{1,2}) and (\d{1,2}) ([A-Za-z]+)\b/i);
    if (!dates || [Number(dates[1]), Number(dates[2]), Number(dates[3])].some((day, index) => day !== titleDates.days[index])) return undefined;
    const month = jeraMonths.indexOf(dates[4].toLowerCase()) + 1;
    if (month !== titleDates.month) return undefined;
    return { editionYear: 2027, startDate: titleDates.startDate, endDate: titleDates.endDate, excerpt: title + "; " + dates[0] };
  }

  if (titleDates.page !== "line up" || !/<form\b[^>]*class="line-up-header"[^>]*>[\s\S]*?<h1>Line up<\/h1>/i.test(html)) return undefined;
  const start = html.search(/<div\b[^>]*class="line-up-grid tile_grid"[^>]*id="lineup"[^>]*>/i);
  if (start < 0) return undefined;
  const end = html.indexOf("<dialog id=\"performance-dialog\">", start);
  if (end < 0) return undefined;
  const grid = html.slice(start, end);
  const cards = [...grid.matchAll(/<div\b[^>]*class="item"[^>]*data-title="[^"]+"[^>]*>/gi)];
  const lineup: string[] = [];
  for (let index = 0; index < cards.length; index++) {
    const card = grid.slice(cards[index].index, cards[index + 1]?.index ?? grid.length);
    const link = card.match(/^<div\b([^>]*)>\s*<a\b([^>]*)>/i);
    const performance = card.match(/<div\b[^>]*class="item-popup-link performance"[^>]*>[\s\S]*?<div\b[^>]*class="item-text"[^>]*>\s*<span\b[^>]*class="title"[^>]*>([^<]+)<\/span>/i);
    const name = decode(performance?.[1] ?? "");
    const href = link && attribute(link[2], "href");
    if (!name || name.length > 100 || name !== (link && attribute(link[2], "title")) || name.toLocaleLowerCase() !== (link && attribute(link[1], "data-title"))?.toLocaleLowerCase()) return undefined;
    if (!href || !/^\/en\/line-up\/[a-z0-9-]+\/$/.test(href) || /\b(?:19|20)\d{2}\b/.test(name) || lineup.some((other) => other.toLocaleLowerCase() === name.toLocaleLowerCase())) return undefined;
    lineup.push(name);
  }
  // The initial 2027 grid contains 21 artists. A partial/filtered/empty page
  // cannot propose mass removals; smaller legitimate removals require review.
  if (lineup.length < 16 || lineup.length > 120) return undefined;
  return { editionYear: 2027, lineup, excerpt: title + "; " + lineup.length + " official artist cards: " + lineup.slice(0, 3).join(", ") };
}

function trees(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})(?:st|nd|rd|th)\s*[-–—]\s*(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})/i);
  if (!date) return undefined;
  const month = String(new Date(`${date[3]} 1, 2000`).getMonth() + 1).padStart(2, "0");
  return { startDate: `${date[4]}-${month}-${pad(date[1])}`, endDate: `${date[4]}-${month}-${pad(date[2])}`, excerpt: date[0] };
}

function tolminator(html: string): AdapterResult | undefined {
  const date = html.match(/(\d{1,2})\s+July\s*[-–—]\s*(\d{1,2})\s+August\s+(20\d{2})/i);
  if (!date) return undefined;
  return { startDate: `${date[3]}-07-${pad(date[1])}`, endDate: `${date[3]}-08-${pad(date[2])}`, excerpt: date[0] };
}

function leyendas(html: string): AdapterResult | undefined {
  const title = html.match(/<title[^>]*>[\s\S]*?Leyendas del Rock\s+(20\d{2})[\s\S]*?<\/title>/i);
  return title ? { excerpt: title[0].replace(/<[^>]+>/g, " ").trim() } : undefined;
}

const adapters: Record<string, (html: string, source: FestivalSource) => AdapterResult | undefined> = {
  "2000trees": trees,
  copenhell,
  "dynamo-metal-fest": dynamoMetalFest,
  "greenfield": greenfield,
  "jera-on-air": jeraOnAir,
  "hurricane": fkpLineup,
  "mera-luna": meraLuna,
  "pinkpop": pinkpop,
  "rock-am-ring": ringAndPark,
  "rock-for-people": rockForPeople,
  "rock-im-park": ringAndPark,
  "southside": fkpLineup,
  "tons-of-rock": tonsOfRock,
  midgardsblot,
  "tuska": tuska,
  "tolminator": tolminator,
  "leyendas-del-rock": leyendas,
};

export function hasOfficialMarkupAdapter(slug: string): boolean {
  return Object.hasOwn(adapters, slug);
}

export function extractOfficialMarkupCandidate(html: string, source: FestivalSource, fetchedAt: string): FestivalCandidate {
  const candidate: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  const result = adapters[source.festivalSlug]?.(html, source);
  if (!result) {
    candidate.warnings.push(`Official markup adapter found no trustworthy fields for ${source.festivalSlug}`);
    return candidate;
  }
  if (result.warning) candidate.warnings.push(result.warning);
  if (result.editionYear) candidate.observedEditionYears.push(result.editionYear);
  if (result.startDate) candidate.observedEditionYears.push(Number(result.startDate.slice(0, 4)));
  for (const field of ["startDate", "endDate", "city", "headliners", "lineup", "status"] as const) {
    const value = result[field];
    if (!value || (Array.isArray(value) && value.length === 0)) continue;
    Object.assign(candidate, { [field]: value });
    candidate.evidence.push({ field: field as FieldEvidence["field"], sourceUrl: source.url, observedAt: fetchedAt, excerpt: result.excerpt.slice(0, 500) });
  }
  // These edition-bound announcements are valuable review evidence, but their
  // lineup changes would enqueue automatic provider playlist creation. Keep
  // them in the assistant-owned review queue until that separate action is authorized.
  if ((source.festivalSlug === "copenhell" && result.headliners?.length) ||
      (source.festivalSlug === "dynamo-metal-fest" && result.lineup?.length))
    candidate.warnings.push("Agent review required before lineup-triggered provider activity");
  if (!candidate.evidence.length && !candidate.warnings.length) candidate.warnings.push("Official title confirms the current edition but exposes no supported structured field");
  return candidate;
}
