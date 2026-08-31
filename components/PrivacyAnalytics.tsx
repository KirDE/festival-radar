"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { sendPrivacyPageView } from "@/lib/privacy-analytics.mjs";

export function PrivacyAnalytics() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    if (!endpoint || lastPath.current === pathname) return;
    lastPath.current = pathname;
    sendPrivacyPageView({ endpoint, pathname, navigator, document });
  }, [pathname]);

  return null;
}
