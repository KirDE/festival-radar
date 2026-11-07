import type { FestivalCandidate, FestivalSource } from "../types.ts";

export const GRASPOP_DOCUMENTS = 'graspop-current-announcements-v1';
export const GRASPOP_HOME = 'https://www.graspop.be/en/';
export const GRASPOP_ROSTER = 'https://www.graspop.be/en/line-up/list';
export const GRASPOP_FAQ = 'https://www.graspop.be/en/info/festival-essentials';
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&#(x[\da-f]+|\d+);/gi, (raw, value: string) => {
  const n = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;
}).replace(/\s+/g, ' ').trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1];
const main = (html: string) => clean(html).match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
const canonical = (html: string) => [...clean(html).matchAll(/<link\b[^>]*>/gi)].find(m => attr(m[0], 'rel') === 'canonical')?.[0];
const picture = (value: string) => value.split('/').at(-1)?.replace(/\.(?:jpg|jpeg|webp|png)$/i, '');
// Official roster/news copy may abbreviate the same featuring credit differently.
// Keep the roster spelling in the candidate; do not alias artists or collaborators.
const announcementName = (value: string) => value.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase().replace(/\b(?:ft|feat)\.?(?=\s)/g, 'featuring');

export function isGraspopSource(source: FestivalSource) {
  return source.festivalSlug === 'graspop' && source.url === GRASPOP_FAQ && source.strategies.includes('official_markup') && !source.fetchUrl && !source.followLinkPattern;
}

export function graspopNewsUrl(value: string): string | undefined {
  try {
    const u = new URL(value, GRASPOP_HOME);
    if (u.origin === new URL(GRASPOP_HOME).origin && !u.username && !u.password && !u.search && !u.hash && /^\/en\/news\/[a-z0-9-]+$/.test(u.pathname)) return u.href;
  } catch { /* Not a trusted news route. */ }
}

/** Discover actual news cards, not a fabricated wrapper or navigation links. */
function announcementCards(html: string) {
  const content = main(html) ?? '';
  const cards: {url:string;image:string}[] = [];
  for (const article of content.matchAll(/<article\b[^>]*class=["']news["'][^>]*>([\s\S]*?)<\/article>/gi)) {
    const title = plain(article[1].match(/<h[1-6]\b[^>]*class=["']news__title["'][^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? '');
    if (!/\bheadliner\b|\b(?:first|new)\b.{0,40}\b(?:names|bands|acts|announcement)\b|line[ -]?up/i.test(title)) continue;
    const link = article[1].match(/<a\b[^>]*>/i)?.[0];
    const url = link && graspopNewsUrl(attr(link, 'href') ?? '');
    const image=attr(article[1].match(/<img\b[^>]*>/i)?.[0] ?? '', 'src') ?? '';
    if (url && !cards.some(c=>c.url===url)) cards.push({url,image});
  }
  if (cards.length > 16) throw new Error('Graspop announcement discovery exceeds its bounded limit');
  return cards;
}
export const discoverGraspopAnnouncements = (html: string) => announcementCards(html).map(c=>c.url);

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The live essentials FAQ has current facts inside an outdated site template. */
function datesOnly(html: string, source: FestivalSource) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!main) return undefined;
  const text = main.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  const pattern = /Graspop Metal Meeting\s+(20\d{2})\s+takes place from\s+(\d{1,2})\s+(?:through|to|[-–—])\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi;
  const dates = [...text.matchAll(pattern)].filter(match => Number(match[1]) === source.editionYear);
  if (!dates.length) return undefined;
  const ranges = dates.map(match => {
    const month = String(months.findIndex(value => value.toLowerCase() === match[4].toLowerCase()) + 1).padStart(2, "0");
    return { startDate: `${match[1]}-${month}-${match[2].padStart(2, "0")}`, endDate: `${match[1]}-${month}-${match[3].padStart(2, "0")}`, excerpt: match[0] };
  });
  const first = ranges[0];
  if (ranges.some(range => range.startDate !== first.startDate || range.endDate !== first.endDate)) return undefined;
  if (first.startDate > first.endDate || [first.startDate, first.endDate].some(date => {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date;
  })) return undefined;
  return first;
}

export function graspop(input: string, source: FestivalSource) {
  if (!input.trimStart().startsWith('{')) return datesOnly(input, source);
  const fail = () => ({excerpt: 'Graspop current announcement could not be independently bound to its roster', warning: 'Graspop current roster/announcement identity, edition, dates or billing requires review'});
  if (!isGraspopSource(source)) return fail();
  try {
    const e = JSON.parse(input);
    if (e.kind !== GRASPOP_DOCUMENTS || typeof e.faq !== 'string' || typeof e.home !== 'string' || typeof e.roster !== 'string' || !Array.isArray(e.articles)) return fail();
    const dates = datesOnly(e.faq, source);
    if (!dates || attr(canonical(e.faq) ?? '', 'href') !== GRASPOP_FAQ || attr(canonical(e.home) ?? '', 'href') !== GRASPOP_HOME) return fail();
    const news = announcementCards(e.home), urls=news.map(c=>c.url);
    if (e.articles.length !== urls.length || e.articles.some((a: {url: string; html: string}, i: number) => !a || a.url !== urls[i] || typeof a.html !== 'string')) return fail();
    if (!urls.length) return dates; // Old landing page, no current artist announcement.
    const roster = main(e.roster);
    if (!roster || ![GRASPOP_ROSTER,'https://www.graspop.be/en/line-up'].includes(attr(canonical(e.roster) ?? '', 'href') ?? '')) return fail();
    const grids=[...roster.matchAll(/<ol\b[^>]*class=["']artists-list["'][^>]*>([\s\S]*?)<\/ol>/gi)];
    if(grids.length!==1)return fail();
    const grid=grids[0][1];
    const cards = [...grid.matchAll(/<article\b[^>]*class=["']artist["'][^>]*>([\s\S]*?)<\/article>/gi)];
    if (!cards.length || cards.length > 250 || cards.length !== [...grid.matchAll(/<article\b[^>]*class=["']artist["']/gi)].length) return fail();
    // A full official confirmations paragraph corroborates support artists;
    // individual headline news continues to determine billing independently.
    const confirmations: string[] = [];
    for (const a of e.articles as {url:string;html:string}[]) {
      const body = main(a.html);
      if (!body || attr(canonical(a.html) ?? '', 'href') !== a.url) return fail();
      const title = plain(body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
      const count = title.match(/^(\d+) new (?:acts|names|bands) confirmed for #?GMM(\d{2}|20\d{2})!$/i);
      if (!count) continue;
      if (Number(count[2]) !== source.editionYear && Number(count[2]) + 2000 !== source.editionYear) return fail();
      const intro = plain(body.match(/<p\b[^>]*class=["']intro["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
      if (!intro.includes(`Graspop Metal Meeting ${source.editionYear}`)) return fail();
      const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
      const lists = paragraphs.map(p => plain(p[1].split(/<br\s*\/?>(?:\s*<br\s*\/?>)?/i)[0]))
        .filter(p => p.startsWith(`Here is the full list of new confirmations for the GMM${source.editionYear} bill: `));
      if (lists.length !== 1 || /(?:cancelled|canceled|withdrawn|will not (?:play|perform))/i.test(intro + lists[0])) return fail();
      const list = lists[0].split(' bill: ')[1].replace(/\.$/, '').replace(/ and ([^,]+)$/, ', $1').split(',').map(n => n.trim());
      if (list.length !== Number(count[1]) || list.some(n => !n || n.length > 120) || new Set(list.map(announcementName)).size !== list.length) return fail();
      const ranges = [...plain(body).matchAll(/\bFrom\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+(June|July|August)\s+(20\d{2})\b/gi)];
      if (!ranges.length || ranges.some(d => `${d[4]}-${String(months.findIndex(m => m.toLowerCase() === d[3].toLowerCase()) + 1).padStart(2,'0')}-${d[1].padStart(2,'0')}` !== dates.startDate || `${d[4]}-${String(months.findIndex(m => m.toLowerCase() === d[3].toLowerCase()) + 1).padStart(2,'0')}-${d[2].padStart(2,'0')}` !== dates.endDate)) return fail();
      confirmations.push(...list);
    }
    const names: string[] = [], headliners: string[] = [], lineup: string[] = [];
    for (const card of cards) {
      const name = plain(card[1].match(/<h3\b[^>]*class=["']artist__name["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '').replace(/[’‘]/g, "'");
      const link = attr(card[1].match(/<a\b[^>]*>/i)?.[0] ?? '', 'href') ?? '';
      const image = attr(card[1].match(/<img\b[^>]*>/i)?.[0] ?? '', 'src') ?? '';
      const target = new URL(link, GRASPOP_HOME);
      const timing = plain(card[1].match(/<span\b[^>]*class=["']artist__timing["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ?? '');
      if (!name || name.length > 120 || target.origin !== new URL(GRASPOP_HOME).origin || target.username || target.password || target.search || target.hash || !/^\/en\/bands\/[a-z0-9-]+$/.test(target.pathname) || new URL(image,GRASPOP_HOME).origin !== target.origin || !picture(image) || names.some(n => n.toLowerCase() === name.toLowerCase())) return fail();
      const proofs = e.articles.filter((a: {url: string; html: string}) => {
        const body = main(a.html);
        if (!body || attr(canonical(a.html) ?? '', 'href') !== a.url) return false;
        const intro = plain(body.match(/<p\b[^>]*class=["']intro["'][^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
        const headings = [...body.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map(h => plain(h[1])).join(' ');
        if (!intro || !/headlin(?:e|er|ing)|top the bill/i.test(headings + ' ' + intro) || !announcementName(intro).includes(announcementName(name)) || /(?:has|have|is|are)\s+(?:cancelled|canceled|withdrawn)|will not (?:play|perform)/i.test(intro)) return false;
        const text = plain(body);
        const range = [...text.matchAll(/\bFrom\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+(June|July|August)\s+(20\d{2})\b/gi)];
        if (!range.length || range.some(d => `${d[4]}-${String(months.findIndex(m => m.toLowerCase() === d[3].toLowerCase()) + 1).padStart(2,'0')}-${d[1].padStart(2,'0')}` !== dates.startDate || `${d[4]}-${String(months.findIndex(m => m.toLowerCase() === d[3].toLowerCase()) + 1).padStart(2,'0')}-${d[2].padStart(2,'0')}` !== dates.endDate)) return false;
        const newsImage=news.find(n=>n.url===a.url)?.image ?? '';
        if (!newsImage || new URL(newsImage,GRASPOP_HOME).origin !== new URL(GRASPOP_HOME).origin) return false;
        const day = timing.split(' • ')[0].trim();
        const days: {day:string;date:Date}[] = [];
        for (let d = new Date(dates.startDate); d <= new Date(dates.endDate); d.setUTCDate(d.getUTCDate()+1)) days.push({day:d.toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'}),date:new Date(d)});
        const date = days.find(d=>d.day===day)?.date;
        return !!date && new RegExp(`\\b${day}\\s+${date.getUTCDate()}\\s+${months[date.getUTCMonth()]}\\b`, 'i').test(intro) && picture(newsImage)===picture(image);
      });
      if (proofs.length > 1) return fail();
      if (proofs.length === 1) headliners.push(name);
      else {
        if (!confirmations.some(n => announcementName(n) === announcementName(name))) return fail();
        // Support cards also require a day within the current edition.
        const day = timing.split(' • ')[0].trim();
        const days: string[] = [];
        for (let d = new Date(dates.startDate); d <= new Date(dates.endDate); d.setUTCDate(d.getUTCDate()+1)) days.push(d.toLocaleDateString('en-GB',{weekday:'long',timeZone:'UTC'}));
        if (!days.includes(day)) return fail();
        lineup.push(name);
      }
      names.push(name);
    }
    if (!headliners.length || confirmations.some(n => !names.some(name => announcementName(n) === announcementName(name)))) return fail();
    return {...dates, editionYear:source.editionYear, headliners, ...(lineup.length ? {lineup} : {}), status:'partial' as const, artistListMode:'additive' as const, lineupScope:'announcement' as const,
      excerpt:dates.excerpt+' Official current roster and edition-bound announcements: '+names.join(', ')};
  } catch { return fail(); }
}

export function isGraspopAnnouncement(candidate: FestivalCandidate, year: number) {
  return !!candidate && candidate.festivalSlug === 'graspop' && candidate.sourceUrl === GRASPOP_FAQ && candidate.artistListMode === 'additive' && candidate.lineupScope === 'announcement' && Array.isArray(candidate.observedEditionYears) && candidate.observedEditionYears.length === 1 && candidate.observedEditionYears[0] === year && Array.isArray(candidate.headliners) && candidate.headliners.length>0 && candidate.status==='partial' && (candidate.lineup===undefined || (Array.isArray(candidate.lineup) && candidate.lineup.length>0)) && Array.isArray(candidate.evidence) && ['startDate','endDate','headliners','status',...(candidate.lineup ? ['lineup'] : [])].every(field=>candidate.evidence.some(e=>e?.field===field && e.sourceUrl===GRASPOP_FAQ));
}
