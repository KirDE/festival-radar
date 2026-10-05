import inventory from "./reviewed-logo-inventory.json" with { type: "json" };
import { databaseLogoPath } from "./logo-serving.ts";

const reviewedBySlug = new Map(inventory.map((row) => [row.slug, row.file]));

/** Festivals without a reviewed local logo use the initials fallback. */
export const festivalLogoFallbacks = new Set([
  "bloodstock",
  "brutal-assault",
  "tolminator",
  "pistoia-blues",
  "polandrock",
]);

export function festivalLogoPath(slug: string) {
  const file = reviewedBySlug.get(slug);
  return file && !festivalLogoFallbacks.has(slug) ? databaseLogoPath(file) : null;
}
