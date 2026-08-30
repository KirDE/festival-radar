const LOCALES = new Set(["en", "de", "ru"]);

export function privacySignalEnabled(navigatorLike) {
  return navigatorLike.doNotTrack === "1" || navigatorLike.globalPrivacyControl === true;
}

export function pageViewPayload(pathname, documentLike) {
  const path = pathname.startsWith("/") ? pathname.split(/[?#]/, 1)[0] : "/";
  const firstSegment = path.split("/")[1]?.toLowerCase();
  const documentLocale = documentLike.documentElement?.lang?.split("-")[0]?.toLowerCase();
  const locale = LOCALES.has(firstSegment) ? firstSegment : LOCALES.has(documentLocale) ? documentLocale : "en";
  return { path, locale };
}

export function sendPrivacyPageView({ endpoint, pathname, navigator, document }) {
  if (!endpoint || privacySignalEnabled(navigator)) return false;
  const body = JSON.stringify(pageViewPayload(pathname, document));
  if (typeof navigator.sendBeacon === "function") return navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
  void fetch(endpoint, { method: "POST", body, headers: { "content-type": "application/json" }, credentials: "omit", keepalive: true });
  return true;
}
