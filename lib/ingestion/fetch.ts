import { isCopenhellCurrentSource, copenhellUrl, copenhellNews, copenhellArtistLinks, copenhellEnvelope, type CopenhellDocument } from "./adapters/copenhell-current.ts";
import { isRockInRomaSource } from "./adapters/rock-in-roma.ts";
import { isInfernoSource, isInfernoResponse } from "./adapters/inferno.ts";
import { discoverMotocultorAnnouncement } from "./adapters/motocultor.ts";
import { isFrequencySource, frequencyTicketLink, frequencyDocuments } from "./adapters/frequency.ts";
import { isPaleoSource, paleoTicketLink, isPaleoTicketUrl } from "./adapters/paleo.ts";
import { isLeedsSource } from "./adapters/leeds.ts";
import { isReadingSource } from "./adapters/reading.ts";
import { isRockImperiumSource, envelopeKind, findRockImperiumLanding, findRockImperiumCategory, findRockImperiumProduct, type PassDocument } from "./adapters/rock-imperium.ts";
import { novarockDocuments, novarockTicketsUrl } from "./adapters/novarock.ts";
import type { FestivalSource } from "./types.ts";

export type FetchAttempt = { response: Response; attempts: number };
export type FetchOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxAttempts?: number;
  baseDelayMs?: number;
};

const retryable = (status: number) => status === 403 || status === 408 || status === 425 || status === 429 || status >= 500;

export async function fetchSource(source: FestivalSource, options: FetchOptions = {}): Promise<FetchAttempt> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1_000);
  const fetchWithRetry = async (url: string, redirect: RequestRedirect = "follow"): Promise<FetchAttempt> => {
    let response: Response | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(url, {
        redirect,
        signal: AbortSignal.timeout(20_000),
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-GB,en;q=0.8",
          "cache-control": "no-cache",
          "user-agent": "FestivalRadarBot/1.1 (+https://festivals.kir-it.de/; public festival-data monitor)",
          ...source.headers,
        },
      });
    } catch (error) {
      if (attempt === maxAttempts) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attempts: attempt });
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000));
      continue;
    }
    if (response.ok || !retryable(response.status) || attempt === maxAttempts) return { response, attempts: attempt };
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? Math.min(retryAfter * 1_000, 30_000) : Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000);
    await sleep(delay);
  }
    throw new Error("Fetch attempts exhausted without a response");
  };

  let initial = await fetchWithRetry(source.fetchUrl ?? source.url);
  if (initial.response.ok && isInfernoSource(source) && source.strategies.includes("html_fallback") && initial.response.url && !isInfernoResponse(initial.response.url)) throw Object.assign(new Error("Inferno source redirected away from its official homepage"), { attempts: initial.attempts });
  if (source.festivalSlug === "motocultor" && source.strategies.includes("official_markup") && initial.response.ok) {
    const url = new URL(source.fetchUrl ?? source.url);
    if (url.origin === "https://www.motocultor-festival.com" && ["/", "/actualites/"].includes(url.pathname)) {
      if (url.pathname === "/") {
        const news = await fetchWithRetry("https://www.motocultor-festival.com/actualites/");
        initial = { ...news, attempts: initial.attempts + news.attempts };
        if (!initial.response.ok) return initial;
      }
      const linkedUrl = discoverMotocultorAnnouncement(await initial.response.text(), source);
      if (!linkedUrl) throw Object.assign(new Error("No current-edition Motocultor announcement found"), { attempts: initial.attempts });
      const linked = await fetchWithRetry(linkedUrl);
      return { response: linked.response, attempts: initial.attempts + linked.attempts };
    }
  }

  if (initial.response.ok && isCopenhellCurrentSource(source)) {
    if (initial.response.url && !copenhellUrl(initial.response.url)) throw new Error("Copenhell source redirected outside its official origin");
    const documents: CopenhellDocument[] = [{ url: source.url, html: await initial.response.text() }];
    let attempts = initial.attempts;
    const read = async (url: string): Promise<Response | undefined> => {
      if (documents.some(d => d.url === url)) return undefined;
      const result = await fetchWithRetry(url, "error"); attempts += result.attempts;
      if (!result.response.ok) return result.response;
      if (result.response.url && result.response.url !== url) throw new Error("Copenhell official document redirected");
      documents.push({ url, html: await result.response.text() });
      return undefined;
    };
    const homeError = await read("https://copenhell.dk/");
    if (homeError) return { response: homeError, attempts };
    const home = documents.find(d => d.url === "https://copenhell.dk/")!;
    for (const url of [...copenhellNews(home.html, source.editionYear), "https://copenhell.dk/program/", "https://copenhell.dk/billetter/"]) {
      const error = await read(url); if (error) return { response: error, attempts };
    }
    const program = documents.find(d => d.url === "https://copenhell.dk/program/")!;
    for (const card of copenhellArtistLinks(program.html).filter(c => c.name.toUpperCase() === "ANGEL DUST")) {
      const error = await read(card.url); if (error) return { response: error, attempts };
    }
    return { response: new Response(JSON.stringify({ kind: copenhellEnvelope, documents }), { headers: { "content-type": "application/json" } }), attempts };
  }

  // The home page mixes old concert news with current navigation. Discover
  // only the linked same-origin lineup for the configured edition.
  if (initial.response.ok && isRockInRomaSource(source) && source.strategies.includes("html_fallback") && !source.fetchUrl && !source.followLinkPattern && new URL(source.url).pathname === "/") {
    if (initial.response.url && new URL(initial.response.url).origin !== "https://rockinroma.com") throw Object.assign(new Error("Rock in Roma homepage redirected away from its trusted origin"), { attempts: initial.attempts });
    const html = await initial.response.text();
    const path = `/lineup-${source.editionYear}/`;
    const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some(match => {
      try { const url = new URL(match[1], source.url); return url.origin === "https://rockinroma.com" && url.pathname === path && !url.search && !url.hash; } catch { return false; }
    });
    if (!linked) return { response: new Response(html, { status: initial.response.status, headers: initial.response.headers }), attempts: initial.attempts };
    const lineup = await fetchWithRetry(new URL(path, source.url).href);
    if (lineup.response.ok && lineup.response.url && lineup.response.url !== new URL(path, source.url).href) throw Object.assign(new Error("Rock in Roma lineup redirected away from its trusted edition page"), { attempts: initial.attempts + lineup.attempts });
    return { response: lineup.response, attempts: initial.attempts + lineup.attempts };
  }
  if (initial.response.ok && isFrequencySource(source) && source.strategies.includes("html_fallback") && !source.fetchUrl && !source.followLinkPattern && new URL(source.url).pathname === "/") {
    if (initial.response.url && new URL(initial.response.url).origin !== "https://www.frequency.at") throw Object.assign(new Error("Frequency homepage redirected away from its official origin"), { attempts: initial.attempts });
    const home = await initial.response.text();
    if (!frequencyTicketLink(home)) return { response: new Response(home, { status: 200, headers: initial.response.headers }), attempts: initial.attempts };
    const tickets = await fetchWithRetry("https://www.frequency.at/tickets/");
    const attempts = initial.attempts + tickets.attempts;
    if (!tickets.response.ok) return { response: tickets.response, attempts };
    if (tickets.response.url && !/^https:\/\/www\.frequency\.at\/tickets\/?$/.test(tickets.response.url)) throw Object.assign(new Error("Frequency ticket page redirected away from its official landing page"), { attempts });
    return { response: new Response(frequencyDocuments(home, await tickets.response.text()), { status: 200, headers: { "content-type": "application/json" } }), attempts };
  }
  // Paléo's homepage redirects to French and exposes only a ticket CTA.
  // Follow the actual same-origin localized landing page, never the account shop.
  if (initial.response.ok && isPaleoSource(source) && source.strategies.includes("html_fallback") && !source.fetchUrl && !source.followLinkPattern) {
    if (initial.response.url && !isPaleoSource({ ...source, url: initial.response.url })) throw Object.assign(new Error("Paleo source redirected away from its trusted route"), { attempts: initial.attempts });
    if (isPaleoTicketUrl(source.url) || (initial.response.url && isPaleoTicketUrl(initial.response.url))) return initial;
    const html = await initial.response.text();
    const link = paleoTicketLink(html, initial.response.url || source.url);
    if (!link) return { response: new Response(html, { status: initial.response.status, headers: initial.response.headers }), attempts: initial.attempts };
    const tickets = await fetchWithRetry(link);
    if (tickets.response.ok && tickets.response.url && !isPaleoTicketUrl(tickets.response.url)) throw Object.assign(new Error("Paleo ticket page redirected away from its trusted route"), { attempts: initial.attempts + tickets.attempts });
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (initial.response.ok && isLeedsSource(source) && !source.fetchUrl && initial.response.url && new URL(initial.response.url).origin !== "https://www.leedsfestival.com") throw Object.assign(new Error("Leeds source redirected away from its trusted origin"), { attempts: initial.attempts });
  // Leeds's homepage carries the current festival span but only a sales CTA.
  // Read the same-origin linked live ticket products to establish availability.
  if (initial.response.ok && isLeedsSource(source) && source.strategies.includes("html_fallback") && !source.fetchUrl && !source.followLinkPattern && new URL(source.url).pathname === "/") {
    const html = await initial.response.text();
    const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((match) => {
      try { const url = new URL(match[1], source.url); return url.origin === "https://www.leedsfestival.com" && /^\/tickets\/?$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
    });
    if (!linked) return { response: new Response(html, { status: initial.response.status, headers: initial.response.headers }), attempts: initial.attempts };
    const tickets = await fetchWithRetry("https://www.leedsfestival.com/tickets");
    if (tickets.response.ok && tickets.response.url && !/^https:\/\/www\.leedsfestival\.com\/tickets\/?$/.test(tickets.response.url)) throw Object.assign(new Error("Leeds ticket page redirected away from its trusted landing page"), { attempts: initial.attempts + tickets.attempts });
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (initial.response.ok && isReadingSource(source) && !source.fetchUrl && initial.response.url && new URL(initial.response.url).origin !== "https://www.readingfestival.com") throw Object.assign(new Error("Reading source redirected away from its trusted origin"), { attempts: initial.attempts });
  // Reading's homepage carries the current festival span but only a sales CTA.
  // Read the same-origin linked live ticket products to establish availability.
  if (initial.response.ok && isReadingSource(source) && source.strategies.includes("html_fallback") && !source.fetchUrl && !source.followLinkPattern && new URL(source.url).pathname === "/") {
    const html = await initial.response.text();
    const linked = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].some((match) => {
      try { const url = new URL(match[1], source.url); return url.origin === "https://www.readingfestival.com" && /^\/tickets\/?$/.test(url.pathname) && !url.search && !url.hash; } catch { return false; }
    });
    if (!linked) return { response: new Response(html, { status: initial.response.status, headers: initial.response.headers }), attempts: initial.attempts };
    const tickets = await fetchWithRetry("https://www.readingfestival.com/tickets");
    if (tickets.response.ok && tickets.response.url && !/^https:\/\/www\.readingfestival\.com\/tickets\/?$/.test(tickets.response.url)) throw Object.assign(new Error("Reading ticket page redirected away from its trusted landing page"), { attempts: initial.attempts + tickets.attempts });
    return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
  }
  if (isRockImperiumSource(source) && initial.response.ok) {
    const finalUrl = new URL(initial.response.url || source.url);
    if (finalUrl.protocol !== "https:" || finalUrl.hostname !== "www.rockimperiumfestival.es" || !/^\/(?:es\/|en\/)?$/.test(finalUrl.pathname))
      throw new Error("Rock Imperium homepage redirected outside its official gateway");
    const home = await initial.response.text();
    const documents: PassDocument[] = [];
    let attempts = initial.attempts;
    let url = findRockImperiumLanding(home, source);
    for (let hop = 0; hop < 3 && url; hop += 1) {
      // Linked seller pages must not redirect outside the reviewed origin.
      const linked = await fetchWithRetry(url, "error");
      attempts += linked.attempts;
      if (!linked.response.ok) return { response: linked.response, attempts };
      if (linked.response.url && linked.response.url !== url) throw new Error("Rock Imperium linked document redirected");
      const document = { url, html: await linked.response.text() };
      documents.push(document);
      url = hop === 0 ? findRockImperiumCategory(document, source.editionYear)
        : hop === 1 ? findRockImperiumProduct(document, source.editionYear) : undefined;
    }
    return { response: new Response(JSON.stringify({ kind: envelopeKind, home, documents }), { status: 200, headers: { "content-type": "application/json" } }), attempts };
  }
  if (source.festivalSlug === "nova-rock" && source.strategies.includes("official_markup") && source.url === "https://www.novarock.at/lineup/" && !source.fetchUrl && !source.followLinkPattern && initial.response.ok) {
    const tickets = await fetchWithRetry(novarockTicketsUrl);
    if (!tickets.response.ok) return { response: tickets.response, attempts: initial.attempts + tickets.attempts };
    return { response: new Response(novarockDocuments(await initial.response.text(), await tickets.response.text()), { headers: { "content-type": "application/json" } }), attempts: initial.attempts + tickets.attempts };
  }
  if (!source.followLinkPattern || !initial.response.ok) return initial;

  const html = await initial.response.text();
  const pattern = new RegExp(source.followLinkPattern, "i");
  const linkedUrl = [...html.matchAll(/<(?:a\b[^>]*href|script\b[^>]*src)\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)]
    .map((match) => match[1] ?? match[2])
    .map((href) => {
      try {
        return new URL(href, initial.response.url || source.fetchUrl || source.url);
      } catch {
        return undefined;
      }
    })
    .find((url) => url && pattern.test(url.pathname));
  if (!linkedUrl) throw Object.assign(new Error(`No official linked page matched ${source.followLinkPattern}`), { attempts: initial.attempts });

  const linked = await fetchWithRetry(linkedUrl.href);
  return { response: linked.response, attempts: initial.attempts + linked.attempts };
}
