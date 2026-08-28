"use client";

import { useState } from "react";

export function FestivalLogo({ slug, name, large = false }: { slug: string; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  return <div className={`festivalLogo ${large ? "large" : ""}`}>{failed ? <span>{initials}</span> : <img src={`${basePath}/logos/${slug}.png`} alt={`${name} logo`} onError={() => setFailed(true)} />}</div>;
}
