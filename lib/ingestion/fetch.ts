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
  let response: Response | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(source.fetchUrl ?? source.url, {
        redirect: "follow",
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
}
