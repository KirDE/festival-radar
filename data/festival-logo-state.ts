import { festivalLogoPath } from "./festival-logos";

export type FestivalLogoState = {
  src: string | null;
};

/** Changing either prop remounts the image state, even when the filename is unchanged. */
export function festivalLogoKey(slug: string, name: string) {
  return JSON.stringify([slug, name]);
}

export function festivalLogoInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("");
}

export function createFestivalLogoState(slug: string, basePath = ""): FestivalLogoState {
  const path = festivalLogoPath(slug);
  return { src: path ? `${basePath}${path}` : null };
}

/** Ignore duplicate/stale errors; an image failure is terminal until the props change. */
export function failFestivalLogo(state: FestivalLogoState, failedSrc: string): FestivalLogoState {
  if (state.src === null || failedSrc !== state.src) return state;
  return { src: null };
}
