// Official ticket announcements alone are not current inventory. Read only the
// browser shop's public sale/storefront GETs; no basket, order or provider writes.
const origin = "https://dynamo-metalfest.nl";
const api = "https://shopping-api.paylogic.com";
const bundleId = "festival-radar-dynamo-tickets";
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1];
const widget = (html: string) => html.match(/<div\b[^>]*data-widget_type=["']theme-post-content\.default["'][^>]*>\s*<div class=["']elementor-widget-container["']>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ?? "";
type Product = { url: string; eventUrl: string; name: string; type: string; separate: boolean; membership: boolean; start: string; end: string };
type Item = { product: string; soldOut: boolean; max: number | null; combo: unknown[] };
type TicketDocument = { url: string; body: string; shopUrl: string; saleUrl: string; saleState: string; saleStart: string; saleEnd: string; eventUrl: string; eventTitle: string; shopEventUrl: string; shopEventTitle: string; eventShopUrl: string; city: string; generated: string; soldOut: boolean; products: Product[]; items: Item[] };
function shopLink(body: string): string | undefined {
  return [...body.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].filter(m => /GET YOUR TICKETS NOW!?/i.test(text(m[1]))).map(m => attr(m[0], "href")).find(u => /^https:\/\/tickets\.dynamo-metalfest\.nl\/[a-f0-9]{32}$/.test(u ?? ""));
}
export async function discoverDynamoTickets(html: string, fetchPage: (url: string, headers?: Record<string, string>) => Promise<Response>): Promise<string> {
  const load = async (url: string, headers?: Record<string, string>) => {
    const r = await fetchPage(url, headers);
    if (!r.ok) throw Object.assign(new Error(`Dynamo ticket source HTTP ${r.status}`), {status: r.status});
    if (r.url && r.url !== url) throw new Error("Dynamo ticket source redirected");
    const body = await r.text();
    if (body.length > 1_000_000) throw new Error("Dynamo ticket document unbounded");
    return body;
  };
  const news = await load(origin + "/nieuws/");
  if (!/<h1\b[^>]*>\s*NIEUWS\s*<\/h1>/i.test(news)) throw new Error("Dynamo news heading missing");
  const urls = [...new Set([...news.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .filter(m => /tickets?\b/i.test(text(m[2])) && !/merch|parking|transport/i.test(text(m[2])))
    .map(m => m[1]).filter(u => /^https:\/\/dynamo-metalfest\.nl\/[a-z0-9-]+\/$/.test(u)))].slice(0, 4);
  const documents: TicketDocument[] = [];
  for (const url of urls) {
    const article = await load(url), body = widget(article);
    const canonical = attr(article.match(/<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i)?.[0] ?? "", "href");
    if (canonical !== url || !/\b2027\b/.test(text(body))) continue;
    const shopUrl = shopLink(body); if (!shopUrl) continue;
    const saleUrl = api + "/sales/" + shopUrl.split("/").at(-1);
    // Shop-issued anonymous bearer stays in memory and goes ONLY to this fixed
    // API storefront. Never serialize raw sale data, JWT, prices or tracking tags.
    const sale = JSON.parse(await load(saleUrl));
    if (sale._links?.self?.href !== saleUrl || typeof sale.jwt_token !== "string" || !sale.jwt_token || sale.jwt_token.length > 10000) throw new Error("Dynamo public sale identity missing");
    const storefront = JSON.parse(await load(api + "/storefront?" + new URLSearchParams({sale: saleUrl}), {authorization: "Bearer " + sale.jwt_token}));
    const event = sale._embedded?.["shop:event"], shopEvent = storefront._embedded?.["shop:event"];
    const products = storefront._embedded?.["shop:product"];
    if (!Array.isArray(products) || products.length > 100 || !Array.isArray(storefront.categories)) throw new Error("Dynamo storefront structure missing");
    const items: Item[] = [];
    const collect = (categories: Record<string, unknown>[], depth = 0) => {
      if (depth > 5 || categories.length > 100) throw new Error("Dynamo storefront categories unbounded");
      for (const category of categories) {
        if (Array.isArray(category.items)) for (const item of category.items) {
          if (items.length >= 100) throw new Error("Dynamo storefront items unbounded");
          items.push({product: item.product, soldOut: item.is_sold_out, max: item.max_quantity, combo: item.combo});
        }
        if (Array.isArray(category.categories)) collect(category.categories, depth + 1);
      }
    };
    collect(storefront.categories);
    documents.push({url, body, shopUrl, saleUrl, saleState: sale.state, saleStart: sale.start_date, saleEnd: sale.end_date,
      eventUrl: event?._links?.self?.href, eventTitle: event?.title?.en,
      shopEventUrl: shopEvent?._links?.self?.href, shopEventTitle: shopEvent?.title?.en,
      eventShopUrl: shopEvent?._links?.["shop:ticketshop"]?.href, city: shopEvent?.location?.city,
      generated: storefront.generated_on, soldOut: storefront.is_sold_out, items,
      products: products.map(p => ({url: p._links?.self?.href, eventUrl: p._links?.["shop:event"]?.href, name: p.name?.en, type: p.type, separate: p.separately_saleable, membership: p.requires_membership, start: p.sale_start, end: p.sale_end}))});
  }
  return html + `<script type="application/json" id="${bundleId}">${JSON.stringify(documents).replace(/</g, "\\u003c")}</script>`;
}
export function extractDynamoTickets(html: string, startDate: string, endDate: string, fetchedAt: string): {ticketsUrl?: string; ticketStatus?: "available"; ticketsExcerpt?: string} {
  try {
    const json = html.match(new RegExp(`<script type="application/json" id="${bundleId}">([\\s\\S]*?)<\\/script>`, "i"))?.[1];
    const docs: TicketDocument[] = JSON.parse(json ?? "[]");
    if (!Array.isArray(docs) || docs.length > 4) return {};
    for (const doc of docs) {
      const date = text(doc.body).match(/Three days of Dynamo Metalfest\. August (\d{1,2}), (\d{1,2}) & (\d{1,2}), (20\d{2})\./i);
      if (!date || `${date[4]}-08-${date[1].padStart(2,"0")}` !== startDate || `${date[4]}-08-${date[3].padStart(2,"0")}` !== endDate || Number(date[2]) !== Number(date[1])+1) continue;
      const now = Date.parse(doc.generated), observed = Date.parse(fetchedAt);
      if (!/^https:\/\/dynamo-metalfest\.nl\/[a-z0-9-]+\/$/.test(doc.url) || shopLink(doc.body) !== doc.shopUrl ||
        doc.saleUrl !== api + "/sales/" + doc.shopUrl.split("/").at(-1) || doc.eventTitle !== `Dynamo Metalfest ${date[4]}` || doc.shopEventTitle !== doc.eventTitle ||
        !/^https:\/\/shopping-api\.paylogic\.com\/events\/[a-f0-9]{32}$/.test(doc.eventUrl) || doc.shopEventUrl !== doc.eventUrl || doc.eventShopUrl !== doc.shopUrl || doc.city !== "Eindhoven" ||
        doc.saleState !== "Published" || !Number.isFinite(now) || !Number.isFinite(observed) || Math.abs(observed - now) > 300_000 || !(Date.parse(doc.saleStart) <= now && Date.parse(doc.saleEnd) > now) || doc.soldOut !== false ||
        !Array.isArray(doc.products) || !Array.isArray(doc.items)) continue;
      const available = doc.products.some(p => p.eventUrl === doc.eventUrl && /^https:\/\/shopping-api\.paylogic\.com\/products\/[a-f0-9]{32}$/.test(p.url) && p.type === "entrance" &&
        /^(?:(?:EARLY BIRD|ADVANCE|REGULAR|INNER CIRCLE) )?WEEKEND TICKET$/.test(p.name) && p.separate === true && p.membership === false && Date.parse(p.start) <= now && Date.parse(p.end) > now &&
        doc.items.some(i => i.product === p.url && i.soldOut === false && (i.max === null || (Number.isInteger(i.max) && i.max > 0)) && Array.isArray(i.combo) && !i.combo.length));
      if (available) return {ticketsUrl: doc.url, ticketStatus: "available", ticketsExcerpt: `Official ${date[4]} purchase announcement corroborated by current published shop and selectable adult weekend admission at ${doc.generated}; closed loyalty/future tiers are not festival sellout. ${doc.shopUrl}`};
    }
  } catch { /* No trustworthy live sale means no new ticket fact. */ }
  return {};
}
