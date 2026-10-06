import { NextRequest, NextResponse } from "next/server";
import { isLanguage, LANGUAGE_PREFERENCE_KEY } from "./lib/language-preference";

export function proxy(request: NextRequest) {
  const routeLocale = request.nextUrl.pathname.match(/^\/(en|de|ru)(?:\/|$)/)?.[1];
  const preference = request.cookies.get(LANGUAGE_PREFERENCE_KEY)?.value;
  const locale = routeLocale ?? (isLanguage(preference) ? preference : "en");
  const headers = new Headers(request.headers);
  headers.set("x-festival-locale", locale);
  const response = NextResponse.next({ request: { headers } });
  // Bare-route HTML/RSC depends on a preference cookie and must never be shared.
  // Static assets and prefixed SEO routes retain their existing behavior.
  if (!routeLocale && !/\.[^/]+$/.test(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Cookie");
  }
  return response;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
