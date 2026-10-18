import type { FestivalSource } from '../types.ts';
export const IMPERICON_HOME = 'https://www.impericon.com/pages/festival';
export const IMPERICON_DOCUMENTS = 'impericon-current-announcements-v1';
export type ImpericonDocument = { url: string; html: string };
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find(v => v !== undefined);
const text = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&#0*39;|&apos;/gi, "'").replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim();
const clean = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const closed = (s: string) => /<\/body>\s*<\/html>\s*$/i.test(s);
export const isImpericonCurrentSource = (s: FestivalSource) => s.festivalSlug === 'impericon' && s.url === IMPERICON_HOME &&
  s.strategies.includes('official_markup') && Number.isInteger(s.editionYear) && !s.fetchUrl && !s.followLinkPattern;
export function impericonArticleUrl(value: string, year: number) {
  try {
    const u = new URL(value, IMPERICON_HOME);
    return u.origin === 'https://www.impericon.com' && !u.username && !u.password && !u.search && !u.hash &&
      new RegExp(`^/blogs/(?:festival|magazine)/impericon-festival-${year}-[a-z0-9-]+$`).test(u.pathname) ? u.href : undefined;
  } catch { return undefined; }
}
export function sameImpericonArticle(a: string, b: string, year: number) {
  return Boolean(impericonArticleUrl(a, year) && impericonArticleUrl(b, year) && new URL(a).pathname.split('/').at(-1) === new URL(b).pathname.split('/').at(-1));
}
export function discoverImpericonAnnouncements(home: string, year: number) {
  if (!closed(home)) throw new Error('Incomplete Impericon festival page');
  const canonicals = [...clean(home).matchAll(/<link\b[^>]*>/gi)].filter(m => attr(m[0], 'rel') === 'canonical');
  if (canonicals.length !== 1 || attr(canonicals[0][0], 'href') !== IMPERICON_HOME) throw new Error('Impericon festival page identity changed');
  const listings = [...clean(home).matchAll(/<article-list\b[^>]*>([\s\S]*?)<\/article-list>/gi)];
  if (listings.length !== 1) throw new Error('Impericon official news listing is missing or ambiguous');
  const urls = new Set<string>();
  for (const a of listings[0][1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const caption = text(a[2]);
    if (!new RegExp(`^Impericon Festival ${year}:`, 'i').test(caption)) continue;
    const url = impericonArticleUrl(attr(a[1], 'href') ?? '', year);
    if (!url) throw new Error('Impericon announcement link left its official edition route');
    urls.add(url);
  }
  if (!urls.size || urls.size > 8) throw new Error('Impericon current news listing is empty or exceeds its bound');
  return [...urls];
}
function articleContent(html: string) {
  const openings = [...html.matchAll(/<div\b[^>]*>/gi)].filter(m => attr(m[0], 'class') === 'article__content');
  if (openings.length !== 1) return;
  const start = openings[0].index! + openings[0][0].length;
  let depth = 1;
  for (const tag of html.slice(start).matchAll(/<\/?div\b[^>]*>/gi)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (!depth) return html.slice(start, start + tag.index!);
  }
}
function name(value: string) {
  return value.length >= 2 && value.length <= 100 && !/[<>:;!?]|\b(?:20\d{2}|tickets?|festival|headliners?|line.?up|announc|merch|hoodie|t-shirt)\b/i.test(value) ? value : undefined;
}
function parseArticle(doc: ImpericonDocument, year: number) {
  if (!closed(doc.html)) throw new Error('Incomplete Impericon announcement');
  const html = clean(doc.html);
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const title = text(h1[0]?.[1] ?? '');
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(m => attr(m[0], 'rel') === 'canonical');
  const canonical = attr(canonicals[0]?.[0] ?? '', 'href') ?? '';
  if (h1.length !== 1 || !new RegExp(`^Impericon Festival ${year}:`, 'i').test(title) || canonicals.length !== 1 || !sameImpericonArticle(doc.url, canonical, year)) throw new Error('Impericon announcement identity or edition changed');
  const article = articleContent(html);
  if (!article) throw new Error('Impericon announcement body missing');
  // Pure ticket/travel posts are not lineup announcements. A new unrecognised
  // announcement must not silently become a successful unchanged import.
  if (/tickets?|price tier|camping|travel|faq/i.test(title) && !/headliner|line.?up|bands?|acts?/i.test(title)) return { headliners: [], lineup: [], excerpt: '' };
  const headliners = new Set<string>(), lineup = new Set<string>();
  let found = false;
  for (const p of article.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const prose = text(p[1]);
    if (/cancel|withdraw|no longer|not performing|former headliner|last year's/i.test(prose)) throw new Error('Impericon cancellation/billing change requires review');
    const links = [...p[1].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].filter(a => {
      try { const u = new URL(attr(a[1], 'href') ?? '', IMPERICON_HOME); return u.origin === 'https://www.impericon.com' && /^\/collections\/[a-z0-9-]+$/.test(u.pathname) && !u.search && !u.hash; } catch { return false; }
    });
    if (/\bheadliners?\b/i.test(prose) && /announc|alongside|line.?up|stage|festival/i.test(prose)) {
      if (!links.length) throw new Error('Impericon headliner has no official artist identity link');
      for (const a of links) { const n = name(text(a[2])); if (!n) throw new Error('Invalid Impericon headliner caption'); headliners.add(n); }
      found = true;
    } else if (/^(?:Officially joining the bill:|Our (?:previous|latest|new) band wave\b)/i.test(prose) && /\b(?:bill|line.?up)\b/i.test(prose)) {
      const biographyList = /^Officially joining the bill:/i.test(prose);
      // In a biography-style wave, <b> labels followed by a dash are artists;
      // <strong>/<i> record and song titles are not lineup members.
      // In a compact recap, take only formatted names before 'join the bill'.
      const list = biographyList ? p[1] : p[1].split(/\bjoin the bill\b/i)[0];
      const formatted = biographyList
        ? [...list.matchAll(/<(b)\b[^>]*>([\s\S]*?)<\/b>(?:<\/a>)?\s*[–—-]/gi)]
        : [...list.matchAll(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      if (!formatted.length) throw new Error('Impericon lineup name structure changed');
      for (const item of formatted) {
        const n = text(item[2]);
        if (/^\w+ \d{1,2}\s*[–—-]\s*\d{1,2}, 20\d{2}$/.test(n)) continue;
        if (!name(n)) throw new Error('Invalid Impericon lineup caption');
        lineup.add(n);
      }
      if (links.some(a => ![...lineup].some(n => n.toLowerCase() === text(a[2]).toLowerCase()))) throw new Error('Unparsed Impericon artist link');
      found = true;
    } else if (links.length) throw new Error('Unrecognised Impericon artist announcement requires review');
  }
  if (!found || !headliners.size && !lineup.size) throw new Error('Impericon announcement exposes no trustworthy artists');
  return { headliners: [...headliners], lineup: [...lineup], excerpt: canonical + '; ' + title + '; ' + [...headliners, ...lineup].join(', ') };
}
export function impericonCurrent(raw: string, source: FestivalSource) {
  if (!isImpericonCurrentSource(source)) return;
  try {
    const env = JSON.parse(raw);
    if (env.kind !== IMPERICON_DOCUMENTS || typeof env.home !== 'string' || !Array.isArray(env.articles)) return;
    const urls = discoverImpericonAnnouncements(env.home, source.editionYear);
    if (env.articles.length !== urls.length || !env.articles.every((d: any, i: number) => d.url === urls[i] && typeof d.html === 'string')) return;
    const tickets = [...clean(env.home).matchAll(/<span\b[^>]*class="[^"]*\bproduct-item-meta__title\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map(m => text(m[1])).filter(t => /\bWeekend Ticket\b/i.test(t));
    const dates = tickets.map(t => t.match(/^(\d{1,2})\/(\d{1,2})\.(\d{2})\.(20\d{2})\b/));
    if (!dates.length || dates.some(d => !d || Number(d[4]) !== source.editionYear)) return;
    const d = dates[0]!;
    if (dates.some(other => other!.slice(1,5).join() !== d.slice(1,5).join())) return;
    const iso = (day: string) => `${d[4]}-${d[3]}-${day.padStart(2, '0')}`;
    const startDate = iso(d[1]), endDate = iso(d[2]);
    if ([startDate,endDate].some(v => !Number.isFinite(new Date(v).getTime()) || new Date(v).toISOString().slice(0,10) !== v) || startDate > endDate) return;
    const headliners = new Map<string,string>(), lineup = new Map<string,string>(), excerpts: string[] = [];
    for (const doc of env.articles) {
      const result = parseArticle(doc, source.editionYear);
      for (const n of result.headliners) headliners.set(n.toLowerCase(), n);
      for (const n of result.lineup) lineup.set(n.toLowerCase(), n);
      if (result.excerpt) excerpts.push(result.excerpt);
    }
    for (const n of headliners.keys()) lineup.delete(n);
    if (!headliners.size || headliners.size + lineup.size > 200) return;
    return { editionYear: source.editionYear, startDate, endDate, headliners: [...headliners.values()], lineup: [...lineup.values()],
      status: 'partial' as const, artistListMode: 'additive' as const, lineupScope: 'announcement' as const,
      excerpt: `Impericon Festival ${source.editionYear}; ${startDate}–${endDate}; ${excerpts.join('; ')}` };
  } catch { return; }
}
