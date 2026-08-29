"use client";
import { useEffect } from "react";
export function PrivacyAnalytics() {
  useEffect(() => {
    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    if (!endpoint || navigator.doNotTrack === "1") return;
    const payload = JSON.stringify({ path: location.pathname, referrer: document.referrer ? new URL(document.referrer).hostname : null });
    navigator.sendBeacon?.(endpoint, new Blob([payload], { type: "application/json" }));
  }, []);
  return null;
}
