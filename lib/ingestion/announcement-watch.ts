import {createHash} from 'node:crypto';
import type {FestivalCandidate,FestivalSource} from './types.ts';

const clean = (html: string) => html.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
const text = (html: string) => html.replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi,' $1 ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();

/** Evidence of a missed announcement is a review signal, never catalogue facts. */
export function announcementCoverageWarning(html: string, source: FestivalSource, candidate: FestivalCandidate): string | undefined {
  if ((candidate.lineup?.length || candidate.headliners?.length) && candidate.evidence.some(e => e.field==='lineup'||e.field==='headliners')) return undefined;
  // Registered adapters may intentionally refresh a recognized bill's status
  // without re-extracting names. Do not reopen these covered first-wave no-ops.
  if (['partial','confirmed'].includes(candidate.status ?? '') && candidate.evidence.some(e=>e.field==='status')) return undefined;
  const visible = clean(html);
  const content = visible.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? visible.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi,'');
  const cues: string[]=[];
  const entries=[...content.matchAll(/<(h[1-6]|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)].map(m=>({attributes:m[2],body:m[3]}));
  for(const img of content.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,'').matchAll(/<img\b([^>]*)>/gi)) {
    const alt=img[1].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    if(alt)entries.push({attributes:'',body:alt});
  }
  for (const entry of entries) {
    const title=text(entry.body);
    if (!title || title.length>600 || /(?:coming|announc(?:e|ing)) soon|will be|to be announced|announced (?:tomorrow|next)|countdown|when (?:will|are)|stay tuned|merch|history|archive|years? (?:of|ago)|\bbald\b|bientôt|binnenkort/i.test(title)) continue;
    const announced=/\b(?:first|new|more)\b.{0,55}\b(?:names|bands|artists|headliners?)\b.{0,35}\b(?:announced|confirmed|revealed|released|added)\b|\b(?:first|new|more)\s+headliner\b|\bheadliner\s+(?:number\s+)?\d+\b|\bline[ -]?up\b.{0,35}\b(?:announced|confirmed|revealed|released|here)\b|\b(?:eerste namen|erste (?:bands|namen)|premiers noms)\b/i.test(title);
    if (!announced) continue;
    let link='';
    // A heading can contain its own anchors; validating only the outer tag
    // would incorrectly promote a linked third-party announcement to official.
    const outer=entry.attributes.match(/(?:^|\s)href\s*=\s*["']([^"']*)["']/i)?.[1];
    const hrefs=[...(outer?[outer]:[]),...[...entry.body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)].map(a=>a[1])];
    const links:string[]=[];let invalid=false;
    for(const href of hrefs){
      try {const u=new URL(href,source.url),base=new URL(source.url);if(u.origin!==base.origin||u.username||u.password||!/^https?:$/.test(u.protocol)){invalid=true;break;}u.hash='';links.push(u.href);} catch {invalid=true;break;}
    }
    if(invalid)continue;
    link=[...new Set(links)].sort().join(' ');
    const years=[...(title+' '+link).matchAll(/\b20\d{2}\b/g)].map(m=>Number(m[0]));
    if (!years.includes(source.editionYear) || years.some(y=>y!==source.editionYear)) continue;
    cues.push(title.toLowerCase()+' '+link);
  }
  const unique=[...new Set(cues)].sort();
  if(!unique.length)return undefined;
  const digest=createHash('sha256').update(JSON.stringify(unique)).digest('hex').slice(0,20);
  return `Official ${source.editionYear} lineup announcement detected but no artist fields extracted [announcement:${digest}]; parser review required`;
}
