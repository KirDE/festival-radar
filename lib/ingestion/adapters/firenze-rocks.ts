import type { FestivalSource } from "../types.ts";

// The official Live Nation holding page has no announced festival facts. Match
// its semantic structure, not a frozen document hash; any announcement/template
// drift must return to review rather than clearing verified catalogue data.
function text(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function attribute(tag: string, name: string): string {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] ?? "";
}
export function firenzeRocks(html: string, source: FestivalSource) {
  const drift = { excerpt: "Firenze Rocks official page changed", warning: "Firenze Rocks holding page changed or is incomplete; review the official announcement before extracting facts" };
  if (!/<title\b[^>]*>\s*Home\s*\|\s*Firenze Rocks\s*<\/title>/i.test(html) ||
      !/<script\b[^>]*\bsrc=["'][^"']*\/holdingPage\/page-[^"']+["']/i.test(html) ||
      /["']@type["']\s*:\s*["'](?:MusicEvent|Festival|Event)["']/i.test(html)) return drift;
  for (const meta of html.matchAll(/<meta\b[^>]*>/gi)) {
    const kind = attribute(meta[0], "name") || attribute(meta[0], "property");
    if (["description", "og:description", "og:title", "twitter:description", "twitter:title"].includes(kind) &&
        attribute(meta[0], "content") !== "Home | Firenze Rocks") return drift;
  }
  const headers = [...html.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi)];
  if (headers.length !== 1 || text(headers[0][1]) !== "Switch language. Current language is Italiano IT") return drift;
  const logos = [...headers[0][1].matchAll(/<img\b[^>]*>/gi)];
  if (logos.length !== 2 || !logos.every(logo => {
    const years = [...logo[0].matchAll(/firenze-rocks-(20\d{2})_primary_black\.png/gi)];
    return attribute(logo[0], "alt") === "Site logo - www.firenzerocks.it - go to homepage" &&
      years.length > 0 && years.every(year => Number(year[1]) < source.editionYear);
  })) return drift;
  const mains = [...html.matchAll(/<main\b[^>]*>([\s\S]*?)<\/main>/gi)];
  if (mains.length !== 1) return drift;
  let body = mains[0][1];
  if (/\bstyle\s*=\s*["'][^"']*(?:url\s*\(|background)/i.test(body)) return drift;
  // Legal footer text and annual copyright are not an edition announcement.
  body = body.replace(/<div\b[^>]*class=["']footer-copyright["'][^>]*>([\s\S]*?)<\/div>/gi, (block, contents: string) => {
    if (!/<(?:img|video|iframe|svg)\b/i.test(contents) && /^Copyright\s*©\s*20\d{2}\s+Firenze Rocks\. Tutti i diritti riservati\.$/i.test(text(contents))) return "";
    const legal = [...contents.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
    const expected = ["https://www.livenation.it/terms", "https://www.livenation.it/cookies", "https://www.livenation.it/privacy", "https://info.livenationinternational.com/accessibility-statement"];
    return !/<(?:img|video|iframe|svg)\b/i.test(contents) && legal.length === expected.length && legal.every((a, i) => attribute(a[0], "href") === expected[i]) &&
      text(contents) === "Termini e condizioni del sito | Informazioni sull'utilizzo del cookie | Privacy Policy | Accessibility Statement" ? "" : block;
  });
  const socials = [...body.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)];
  const expectedSocials = ["https://www.facebook.com/firenzerocks/", "https://www.instagram.com/firenze_rocks/", "https://x.com/firenzerocks"];
  if (socials.length !== 3 || !socials.every((a, i) => {
    let link: URL;
    try { link = new URL(attribute(a[0], "href")); } catch { return false; }
    const images = [...a[0].matchAll(/<img\b[^>]*>/gi)];
    return link.origin + link.pathname === expectedSocials[i] && !link.username && !link.password &&
      images.length === 1 && ["width", "height"].every(key => Number(attribute(images[0][0], key)) > 0 && Number(attribute(images[0][0], key)) <= 70) &&
      /^(?:|Facebook|Instagram|X)$/i.test(attribute(images[0][0], "alt")) &&
      /^https:\/\/networksites\.livenationinternational\.com\/networksites\/[^/]+\/image\.png(?:\?|$)/i.test(attribute(images[0][0], "src")) && !text(a[0]);
  })) return drift;
  body = body.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  const videos = [...body.matchAll(/<video\b[^>]*>([\s\S]*?)<\/video>/gi)];
  if (videos.length !== 1) return drift;
  const sources = [...videos[0][1].matchAll(/<source\b[^>]*>/gi)];
  if (sources.length !== 2 || !sources.every(s => /^https:\/\/networksites\.livenationinternational\.com\/networksites\/(?:k4tcpivz\/video-sito-mob|4jklndou\/video-sito-desk)\.mp4$/i.test(attribute(s[0], "src"))) ||
      text(videos[0][1])) return drift;
  body = body.replace(videos[0][0], "");
  // Unknown widgets, poster images, ticket links and even text-only announcements
  // are not a holding page. Do not guess facts or remove a partial lineup.
  if (/<\/?(?!h1\b|h3\b|section\b|div\b|p\b)[a-z][^>]*>/i.test(body) ||
      text(body) !== "Home | Firenze Rocks SEGUICI") return drift;
  return { noAnnouncement: true, excerpt: "Official Firenze Rocks holding page: generic video and social links only; no edition announcement" };
}
