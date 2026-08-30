import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const locale = request.nextUrl.pathname.match(/^\/(en|de|ru)(?:\/|$)/)?.[1] ?? "en";
  const headers = new Headers(request.headers);
  headers.set("x-festival-locale", locale);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
