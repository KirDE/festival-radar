export function privacySignalEnabled(navigatorLike: Navigator & { globalPrivacyControl?: boolean }): boolean;
export function pageViewPayload(pathname: string, documentLike: Document): { path: string; locale: "en" | "de" | "ru" };
export function sendPrivacyPageView(input: { endpoint: string; pathname: string; navigator: Navigator & { globalPrivacyControl?: boolean }; document: Document }): boolean;
