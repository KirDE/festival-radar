"use client";

import { useState } from "react";
import { festivalLogoPath } from "../data/festival-logos";

export function FestivalLogo({ slug, name, large = false }: { slug: string; name: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const logoPath = festivalLogoPath(slug);
  const fallback = failed || !logoPath;
  return <div className={`festivalLogo ${large ? "large" : ""}`}>{fallback ? <span role="img" aria-label={`${name} logo fallback`}>{initials}</span> : <img src={`${basePath}${logoPath}`} alt={`${name} logo`} width={large ? 114 : 50} height={large ? 84 : 36} onError={() => setFailed(true)} />}</div>;
}
