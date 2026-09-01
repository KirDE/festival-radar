import { error } from "@/lib/api";

export function requestHasTrustedOrigin(request: Request, configuredAppUrl = process.env.APP_URL) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const expected = configuredAppUrl ? new URL(configuredAppUrl).origin : new URL(request.url).origin;
    return new URL(origin).origin === expected && origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function rejectUntrustedOrigin(request: Request) {
  return requestHasTrustedOrigin(request) ? null : error("Untrusted request origin.", 403);
}
