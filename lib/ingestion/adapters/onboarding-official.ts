import type { FestivalSource } from '../types.ts';

const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&nbsp;|&#160;/gi, ' ').replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n,16))).replace(/\s+/g, ' ').trim();
const attr = (tag: string, key: string) => tag.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
function range(year: number, month: number, days: number[]) {
  if (!days.length || days.some((day,i) => day < 1 || new Date(Date.UTC(year,month-1,day)).getUTCMonth() !== month-1 || (i>0 && day !== days[i-1]+1))) return undefined;
  return {startDate: `${year}-${String(month).padStart(2,'0')}-${String(days[0]).padStart(2,'0')}`, endDate: `${year}-${String(month).padStart(2,'0')}-${String(days.at(-1)).padStart(2,'0')}`};
}
function result(source: FestivalSource, dates: {startDate: string; endDate: string}, names: string[]) {
  if (!names.length || names.some(n => !n || n.length>100 || /[<>]|&[a-z#\d]+;|\b(?:coming soon|tba|20\d{2})\b/i.test(n))) return undefined;
  return {...dates, editionYear: source.editionYear, lineup: [...new Map(names.map(n => [n.toLowerCase(),n])).values()], status: 'partial' as const, artistListMode: 'additive' as const, lineupScope: 'announcement' as const, excerpt: `${dates.startDate}–${dates.endDate}; ${names.join('; ')}`};
}

export function vainstream(html: string, source: FestivalSource) {
  if (source.url !== 'https://vainstream.com/artists/') return undefined;
  const h=clean(html), title=text(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'');
  if (title !== `Artists - Vainstream ${source.editionYear}` || !h.includes('</main>')) return undefined;
  const dateMatches=[...h.matchAll(/<p\b[^>]*>\s*(\d{1,2})\.\s*[-–]\s*(\d{1,2})\.\s*Juni\s+(20\d{2})\s*<br\s*\/?>/gi)];
  if(dateMatches.length!==1 || Number(dateMatches[0][3])!==source.editionYear) return undefined;
  const d=dateMatches[0], first=Number(d[1]), last=Number(d[2]);
  if(last<first || last-first>7) return undefined;
  const dates=range(source.editionYear,6,Array.from({length:last-first+1},(_,i)=>first+i));if(!dates)return undefined;
  const names: string[]=[];
  for(const card of h.matchAll(/<article\b([^>]*)>([\s\S]*?)<\/article>/gi)) {
    if(!/\bfusion-portfolio-post\b/.test(attr(card[1],'class')??'')) continue;
    if (/\bfusion-grid-sizer\b/.test(attr(card[1],'class')??'') && !card[2].trim()) continue;
    const heading=card[2].match(/<h2\b[^>]*class=["'][^"']*\bfusion-post-title\b[^"']*["'][^>]*>\s*<a\b([^>]*)>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if(!heading)return undefined;
    let url: URL;try{url=new URL(attr(heading[1],'href')??'',source.url)}catch{return undefined}
    if(url.origin!=='https://vainstream.com'||url.username||url.password||url.hash||!/^\/projects\/[a-z0-9-]+\/$/.test(url.pathname)|| (url.search && url.search!=='?portfolioCats=28'))return undefined;
    const name=text(heading[2]);
    // Official short bill label corresponds to the established artist identity.
    names.push(name==='BARBARIANS OF CALIFORNIA'?'The Barbarians of California':name);
  }
  return result(source,dates,names);
}

export function rockTheLakes(html: string, source: FestivalSource) {
  if(source.url!==`https://www.rockthelakes.ch/artistes-${source.editionYear}/`)return undefined;
  const h=clean(html), title=text(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'');
  if(title!==`Artistes ${source.editionYear} | Rock The Lakes`)return undefined;
  const main=h.match(/<main\b[^>]*id=["']tm-main["'][^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if(!main || !new RegExp(`<h1[^>]*>\\s*Lineup ${source.editionYear}\\s*</h1>`,'i').test(main))return undefined;
  const cards=[...main.matchAll(/<h3\b[^>]*class=["'][^"']*\bel-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/gi)];
  const names: string[]=[], ranges: string[]=[];
  for(let i=0;i<cards.length;i++) {
    const body=main.slice(cards[i].index!+cards[i][0].length,cards[i+1]?.index??main.length);
    const date=text(body.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i)?.[1]??'').match(/^(\d{1,2}(?:\s*●\s*\d{1,2})+)\s+August$/);
    if(!date)return undefined;
    ranges.push(date[1].replace(/\s/g,''));names.push(text(cards[i][1]));
  }
  if(new Set(ranges).size!==1)return undefined;
  const dates=range(source.editionYear,8,ranges[0]?.split('●').map(Number)??[]);if(!dates)return undefined;
  return result(source,dates,names);
}
