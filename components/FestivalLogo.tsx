"use client";

import { useState } from "react";
import { createFestivalLogoState, failFestivalLogo, festivalLogoInitials, festivalLogoKey } from "../data/festival-logo-state";

type FestivalLogoProps = { slug: string; name: string; large?: boolean };

export function FestivalLogo(props: FestivalLogoProps) {
  return <FestivalLogoImage key={festivalLogoKey(props.slug, props.name)} {...props} />;
}

function FestivalLogoImage({ slug, name, large = false }: FestivalLogoProps) {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const [state, setState] = useState(() => createFestivalLogoState(slug, basePath));
  const src = state.src;
  return <div className={`festivalLogo ${large ? "large" : ""}`}>
    {src === null
      ? <span role="img" aria-label={`${name} logo fallback`}>{festivalLogoInitials(name)}</span>
      : <img key={src} src={src} alt={`${name} logo`} width={large ? 114 : 50} height={large ? 84 : 36}
          onError={() => setState((current) => failFestivalLogo(current, src))} />}
  </div>;
}
