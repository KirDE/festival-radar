import type { FestivalSource } from '../types.ts';

export const LEYENDAS_ORIGIN = 'https://www.leyendasdelrockfestival.com';
export const LEYENDAS_DOCUMENTS = 'leyendas-official-news-v1';
export const LEYENDAS_ARTIST_REVIEW = 'Agent review required before Leyendas lineup-triggered provider activity';
type Document = {url: string; html: string};
const attr = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))?.slice(1).find(v => v !== undefined);
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/\s+/g, ' ').trim();
const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
function trusted(url: string, path?: string): boolean {
  try { const u = new URL(url); return u.origin === LEYENDAS_ORIGIN && !u.search && !u.hash && !u.username && !u.password && (!path || u.pathname === path); } catch { return false; }
}
export function isLeyendasSource(source: FestivalSource): boolean {
  return source.festivalSlug === 'leyendas-del-rock' && trusted(source.fetchUrl ?? source.url, '/') && source.strategies.includes('official_markup');
}
export function leyendasLinkedRoute(html: string, path: string): boolean {
  return [...html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '').matchAll(/<a\b([^>]*)>/gi)].some(m => { try { return trusted(new URL(attr(m[1], 'href') ?? '', LEYENDAS_ORIGIN).href, path); } catch { return false; } });
}
function edition(title: string, year: number): boolean {
  const years = title.replace(/\bSince\s+20\d{2}\b/gi, '').match(/\b20\d{2}\b/g) ?? [];
  return /Leyendas\s+del\s+Rock/i.test(title) && years.length > 0 && years.every(y => Number(y) === year);
}
export function leyendasNewsLinks(html: string, source: FestivalSource): string[] {
  const links: string[] = [];
  for (const m of clean(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/<h2\b[^>]*class=["'][^"']*\blc_post_title\b/i.test(m[2]) || !edition(text(m[2]), source.editionYear)) continue;
    try { const url = new URL(attr(m[1], 'href') ?? '', LEYENDAS_ORIGIN); if (trusted(url.href) && /^\/[a-z0-9-]+\/$/.test(url.pathname) && !links.includes(url.href)) links.push(url.href); } catch { /* not a fetch target */ }
  }
  return links;
}
function artist(value: string): string | undefined {
  const label = text(value);
  if (!label || label.length > 100 || /\b20\d{2}\b|[:!?€]|\b(?:bandas|grupos|artistas|cartel|entradas|abonos)\b/i.test(label)) return undefined;
  return label === label.toLocaleUpperCase() ? label.split(' ').map((word, index) => {
    const lower = word.toLocaleLowerCase(); return index && ['and', 'of', 'the', 'del', 'de'].includes(lower) ? lower : word[0].toLocaleUpperCase() + lower.slice(1);
  }).join(' ') : label;
}

// Headlines and explicitly enumerated prose are announcements, not a ranked
// full bill. Image-only support and poster billing stay independently verified
// in the catalogue; unfamiliar announcement titles return to review.
export function leyendas(html: string, source: FestivalSource) {
  if (!isLeyendasSource(source)) return undefined;
  let data: {kind: string; home: string; news: string; tickets: string; posts: Document[]};
  try { data = JSON.parse(html); } catch { return undefined; }
  if (data.kind !== LEYENDAS_DOCUMENTS || typeof data.home !== 'string' || typeof data.news !== 'string' || typeof data.tickets !== 'string' || !Array.isArray(data.posts)) return undefined;
  const newsTitle = text(clean(data.news).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  if (newsTitle !== 'NOTICIAS') return undefined;
  const title = text(data.home.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  if (!edition(title, source.editionYear)) return undefined;
  const headliners: string[] = [], lineup: string[] = [], excerpts: string[] = [], warnings: string[] = [];
  const links = leyendasNewsLinks(data.news, source);
  if (links.length > 8) warnings.push('Leyendas current-edition news exceeds the bounded discovery limit; review remaining announcements');
  for (const post of data.posts) {
    if (!post || typeof post.html !== 'string' || !links.includes(post.url) || !trusted(post.url)) return undefined;
    const h = clean(post.html), heading = text(h.match(/<h1\b[^>]*class=["'][^"']*\btitle_full_color\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    if (!edition(heading, source.editionYear)) { warnings.push('Leyendas linked article does not confirm the configured edition'); continue; }
    const body = h.split(/<div\b[^>]*\bid=["']sidebar["']/i)[0];
    const paragraphs = [...body.matchAll(/<p\b[^>]*class=["'][^"']*\bwp-block-paragraph\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)].map(m => text(m[1]));
    if (/cancelad|cancelaci[oó]n|no actuar|no tocar|sustitui|se cae|retirad/i.test(heading + ' ' + paragraphs.join(' '))) { warnings.push('Leyendas cancellation or replacement announcement requires review'); continue; }
    const lead = heading.match(/^(.+?)\s+(?:CONFIRMAD[OA]S?|REVENTAR[ÁA]N?|ENCABEZAR[ÁA]|SE INCORPORA|SE SUMA)(?=\s|$)/i);
    const name = lead && artist(lead[1]);
    if (!name) { warnings.push('Leyendas current announcement needs textual or image review: ' + heading); continue; }
    const explicitHeadliner = /\bENCABEZAR[ÁA](?=\s|$)/i.test(heading) && paragraphs.some(p => /\bheadliner\b|cabeza de cartel/i.test(p));
    (explicitHeadliner ? headliners : lineup).push(name);
    for (const paragraph of paragraphs) {
      if (!/^A este nuevo anuncio de bandas se unen\b/i.test(paragraph)) continue;
      for (const m of paragraph.matchAll(/\p{Extended_Pictographic}\uFE0F?\s+([^,.;!?]+)(?=[,.;!?]|$)/gu)) { const support = artist(m[1]); if (support) lineup.push(support); }
    }
    excerpts.push(post.url + ': ' + heading);
  }
  if (links.slice(0, 8).some(url => !data.posts.some(p => p.url === url))) warnings.push('Leyendas current-edition article was not fetched');
  const ticketHtml = clean(data.tickets), ticketTitle = text(ticketHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  let ticketsUrl: string | undefined, ticketStatus: 'available' | undefined, ticketsExcerpt: string | undefined;
  if (edition(ticketTitle, source.editionYear)) {
    // Scope stock to the general festival pass. Camping, pool, shop and stale
    // anniversary homepage copy cannot establish available admission tickets.
    const pass = ticketHtml.match(/<h2\b[^>]*>\s*ABONO LEYENDAS DEL ROCK\s*<\/h2>([\s\S]*?)(?=<h2\b|$)/i)?.[1] ?? '';
    const canBuy = [...pass.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].some(m => {
      if (text(m[2]) !== 'COMPRAR ABONO' || /\bdisabled\b|aria-disabled=["']true/i.test(m[1])) return false;
      try { const u = new URL(attr(m[1], 'href') ?? ''); return u.origin === 'https://www.enterticket.es' && /^\/eventos\/leyendas-del-rock-\d+$/.test(u.pathname) && !u.search && !u.hash && !u.username && !u.password; } catch { return false; }
    });
    if (canBuy && /Ya se pueden adquirir los abonos para la [IVXLCDM]+ edici[oó]n de Leyendas del Rock/i.test(text(pass)) && !/agotad|sold out|cancelad|no disponibles/i.test(text(pass))) {
      ticketsUrl = LEYENDAS_ORIGIN + '/tickets/'; ticketStatus = 'available'; ticketsExcerpt = ticketTitle + '; ' + text(pass).slice(0, 350);
    }
  }
  const unique = (names: string[]) => [...new Map(names.map(name => [name.toLocaleLowerCase(), name])).values()];
  const top = unique(headliners), support = unique(lineup).filter(name => !top.some(h => h.toLocaleLowerCase() === name.toLocaleLowerCase()));
  if (top.length || support.length) warnings.push(LEYENDAS_ARTIST_REVIEW);
  return { editionYear: source.editionYear, ...(top.length ? {headliners: top} : {}), ...(support.length ? {lineup: support} : {}),
    artistListMode: 'additive' as const, lineupScope: 'announcement' as const,
    ...(top.length || support.length ? {status: 'partial' as const} : {}), ticketsUrl, ticketStatus, ticketsExcerpt,
    excerpt: excerpts.join('; ').slice(0, 500) || ticketTitle,
    ...(warnings.length ? {warnings: [...new Set(warnings)]} : {}) };
}
