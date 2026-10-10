import type { FestivalSource } from "../types.ts";

const text = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&#0*39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find(value => value !== undefined);
// Identity corrections corroborated by the official news article, not a bill
// allowlist. Future artists are still read from the edition's live stage grid.
const logoAliases: Record<string, string> = {
  "DEVIL DRIVER": "DevilDriver", "HUMANITYS LAST BREATH": "Humanity's Last Breath",
  "GAMMA BOMB": "Gama Bomb", "KANONEFIEBER": "Kanonenfieber",
  "SPACE OF VARATIONS": "Space of Variations", "DETHLOK": "Dethklok",
};
const months: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const artistName = (value: string) => logoAliases[value.toUpperCase()] ?? value;

export function bloodstock(html: string, source: FestivalSource) {
  const clean = html.replace(/<!--[^]*?-->/g, "").replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi, "");
  const dateBlock = clean.match(/<div\b[^>]*class=["']event-info__content["'][^>]*>([^]*?)<\/div>/i)?.[1];
  const date = dateBlock && text(dateBlock).match(/\b([A-Za-z]+)\s+(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+(20\d{2})$/i);
  if (!date || !months[date[1].toLowerCase()] || Number(date[4]) !== source.editionYear || Number(date[2]) < 1 || Number(date[3]) > 31 || Number(date[2]) > Number(date[3])) return undefined;
  const stages = clean.split(/<div\b[^>]*class=["']line_up__stage["'][^>]*>/i).slice(1);
  const headliners: string[] = [], lineup: string[] = [];
  let mainStage = false;
  for (const stage of stages) {
    const heading = stage.match(/<div\b[^>]*class=["']line_up__stage_name["'][^>]*>([^]*?)<\/div>/i)?.[1];
    const stageLink = heading?.match(/<a\b([^>]*)>([^]*?)<\/a>/i);
    if (!stageLink) continue;
    const stageHref = attr(stageLink[1], "href");
    let stageUrl: URL;
    try { stageUrl = new URL(stageHref ?? "", "https://bloodstock.uk.com/"); } catch { continue; }
    if (!["bloodstock.uk.com", "www.bloodstock.uk.com"].includes(stageUrl.hostname) || !stageUrl.pathname.startsWith(`/events/boa-${source.editionYear}/stages/`)) continue;
    const isMain = stageUrl.pathname.endsWith("/ronnie-james-dio-stage");
    mainStage ||= isMain;
    for (const link of stage.matchAll(/<a\b([^>]*)>([^]*?)<\/a>/gi)) {
      let url: URL;
      try { url = new URL(attr(link[1], "href") ?? "", "https://bloodstock.uk.com/"); } catch { continue; }
      if (!["bloodstock.uk.com", "www.bloodstock.uk.com"].includes(url.hostname) || !new RegExp(`^/events/boa-${source.editionYear}/bands/[^/]+/?$`).test(url.pathname)) continue;
      const image = link[2].match(/<img\b[^>]*>/i)?.[0];
      const label = image && attr(image, "alt");
      if (!label?.startsWith("Band Logo for ")) continue;
      const name = artistName(text(label.slice("Band Logo for ".length)));
      if (!name) continue;
      const target = isMain && (attr(image!, "class") ?? "").split(/\s+/).includes("headliner") ? headliners : lineup;
      if (!target.some(existing => existing.toLowerCase() === name.toLowerCase())) target.push(name);
    }
  }
  if (!mainStage || !headliners.length || !lineup.length) return undefined;
  return { editionYear: source.editionYear, startDate: `${date[4]}-${months[date[1].toLowerCase()]}-${date[2].padStart(2, "0")}`, endDate: `${date[4]}-${months[date[1].toLowerCase()]}-${date[3].padStart(2, "0")}`,
    headliners, lineup: lineup.filter(name => !headliners.some(headliner => headliner.toLowerCase() === name.toLowerCase())),
    // A populated stage grid is not evidence that announcements are finished.
    status: "partial" as const, excerpt: `${text(dateBlock!)}; Ronnie James Dio main-stage headliners: ${headliners.join(", ")}; edition-bound band-logo links across announced stages (partial bill).` };
}
