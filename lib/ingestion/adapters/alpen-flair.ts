import type { FestivalCandidate, FestivalSource, FieldEvidence } from '../types.ts';
import { INGESTION_SCHEMA_VERSION } from '../types.ts';
import { visibleHtml } from './reading.ts';
const origin = 'https://www.alpen-flair.com';
export const ALPEN_ARTIST_REVIEW = 'New Alpen Flair announcement artists require independent review before provider activity';
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim().normalize('NFC');
export function isAlpenFlairSource(source: FestivalSource): boolean {
  try { const u = new URL(source.url); return source.festivalSlug === 'alpen-flair' && u.origin === origin && !u.username && !u.password && !u.search && !u.hash && ['/', '/index.php'].includes(u.pathname); } catch { return false; }
}
export function alpenAnnouncements(html: string, year: number): string[] {
  const links: string[] = [];
  for (const m of visibleHtml(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    try { const u = new URL(text(m[1]), origin); const id = u.searchParams.get('id') ?? '';
      if (u.origin === origin && !u.username && !u.password && !u.hash && u.pathname === '/index.php' && u.searchParams.get('view') === 'article' && new RegExp(`^\\d+:alpen-flair-${year}-.*(?:band|lineup|acts)`).test(id) && [...u.searchParams.keys()].every(k => ['view','id','catid'].includes(k)) && !links.includes(u.href)) links.push(u.href);
    } catch { /* no external/social/archive discovery */ }
  }
  return links.slice(0, 6);
}
function divBlock(html: string, start: number): string {
  let depth = 0;
  for (const token of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(token[0]) ? -1 : 1;
    if (!depth) return html.slice(start, start + token.index! + token[0].length);
  }
  return '';
}
type Document = { url: string; html: string };
export const alpenEnvelope = (home: string, articles: Document[]) => JSON.stringify({ kind: 'alpen-flair-official', home, articles });
export function extractAlpenFlairCandidate(input: string, source: FestivalSource, fetchedAt: string): FestivalCandidate | undefined {
  if (!isAlpenFlairSource(source)) return undefined;
  let home = input, articles: Document[] = [];
  if (input.trimStart().startsWith('{')) {
    try { const j = JSON.parse(input); if (j.kind !== 'alpen-flair-official' || typeof j.home !== 'string' || !Array.isArray(j.articles)) return undefined; home = j.home; const links = alpenAnnouncements(home, source.editionYear!); articles = j.articles.filter((d: Document) => d && typeof d.html === 'string' && links.includes(d.url)); } catch { return undefined; }
  }
  home = visibleHtml(home);
  const ranges = [...home.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(m[1]).match(/^June (\d{1,2})\s*[-–—]\s*(\d{1,2}) (20\d{2}) - NATZ, SOUTH TYROL$/i)).filter(m => m !== null);
  const range = ranges[0];
  const c: FestivalCandidate = { schemaVersion: INGESTION_SCHEMA_VERSION, festivalSlug: source.festivalSlug, sourceUrl: source.url, fetchedAt, evidence: [], warnings: [], observedEditionYears: [] };
  if (!range || ranges.length !== 1) { c.warnings.push('Alpen Flair current festival date heading requires review'); return c; }
  const year = Number(range[3]), first = Number(range[1]), last = Number(range[2]); c.observedEditionYears = [year];
  if (year !== source.editionYear) { c.warnings.push('Alpen Flair visible edition differs from configured edition'); return c; }
  if (first < 1 || last > 30 || last < first || last-first > 7) { c.warnings.push('Invalid Alpen Flair festival dates'); return c; }
  const add = (field: FieldEvidence['field'], value: string | string[], excerpt: string, url = source.url) => { Object.assign(c, {[field]:value}); c.evidence.push({field, sourceUrl:url, observedAt:fetchedAt, excerpt:excerpt.slice(0,500)}); };
  add('startDate', `${year}-06-${String(first).padStart(2,'0')}`,range[0]); add('endDate', `${year}-06-${String(last).padStart(2,'0')}`,range[0]);
  // Require the edition-tagged festival ticket image and explicit live sales
  // copy within the same card. Never return/fetch the untrusted shop URL.
  for (const m of home.matchAll(/<div\b[^>]*class=["'][^"']*\buk-card-primary\b[^"']*["'][^>]*>/gi)) {
    const card = divBlock(home, m.index!);
    if (!new RegExp(`AF${year}_Festival_Ticket`).test(card)) continue;
    const title = text(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '');
    const description = text(card.match(/<div\b[^>]*class=["'][^"']*\bel-meta\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '');
    const buy = [...card.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(a => !/aria-disabled=["']true["']|\sdisabled(?:\s|=|$)/i.test(a[1]) && /^JETZT BESTELLEN!$/i.test(text(a[2])) && /href=["']https:\/\/shop\.alpen-flair\.com\/listing\.html\?/i.test(a[1]));
    if (!/\b(?:ausverkauft|sold\s*out)\b/i.test(text(card)) && /^VVK ist gestartet!$/i.test(title) && /^Die limitierten Frühbuchertickets können JETZT bestellt werden!$/i.test(description) && buy) { add('ticketsUrl',source.url,`${title}; ${description}`); add('ticketStatus','available',`${title}; ${description}`); }
  }
  if (!articles.length && new RegExp(`ALPEN FLAIR ${year}.*(?:BANDWELLE|BANDS|LINEUP|ACTS)`, 'i').test(text(home)))
    c.warnings.push('Alpen Flair current announcement link could not be verified');
  const names: string[] = [];
  for (const d of articles) {
    const html = visibleHtml(d.html), main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
    const heading = text(main.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? '');
    if (!new RegExp(`ALPEN FLAIR ${year}.*(?:BANDWELLE|BANDS|LINEUP|ACTS)`, 'i').test(heading)) { c.warnings.push('Alpen Flair linked announcement edition/title requires review'); continue; }
    if ([...text(main).matchAll(/\b\d{1,2}\.\d{2}\.(20\d{2})\b/g)].some(m => Number(m[1]) !== year)) {
      c.warnings.push('Alpen Flair announcement dates differ from the configured edition'); continue;
    }
    // The announcement's emoji-prefixed dir=auto rows are artist captions;
    // dates/location and prose are separate rows. No logo OCR or billing guess.
    let count = 0;
    for (const row of main.matchAll(/<div\b[^>]*dir=["']auto["'][^>]*>([\s\S]*?)<\/div>/gi)) {
      if (!/^\s*<span\b[^>]*>\s*<img\b[^>]*alt=["'](?:⚓|🔥|🎺|🎸|🎤|🥁|🎵|🎶)["'][^>]*>\s*<\/span>/u.test(row[1])) continue;
      const name = text(row[1]); if (!name || name.length > 100 || /[.!?]|\b20\d{2}\b/.test(name)) continue;
      count++; if (!names.some(n => n.toLocaleLowerCase() === name.toLocaleLowerCase())) names.push(name);
    }
    if (!count) c.warnings.push('Alpen Flair image-only announcement needs independent visual artist review');
    if (count) { c.artistListMode='additive'; c.lineupScope='announcement'; add('lineup',[...names],`${heading}; ${names.join('; ')}`,d.url); add('status','partial',heading,d.url); }
  }
  if (names.length) c.warnings.push(ALPEN_ARTIST_REVIEW);
  return c;
}
