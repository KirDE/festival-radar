/** Festivals without a reviewed local logo use the initials fallback. */
export const festivalLogoFallbacks = new Set([
  "bloodstock",
  "brutal-assault",
  "metaldays",
  "pistoia-blues",
  "polandrock",
]);

export function festivalLogoPath(slug: string) {
  return festivalLogoFallbacks.has(slug) ? null : `/logos/${slug}.png`;
}
