"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js")
        .then(() => navigator.serviceWorker.ready)
        .then(() => fetch("/api/offline/catalog/", { credentials: "omit", cache: "no-cache" }))
        .catch(() => undefined);
    }
  }, []);
  return null;
}
