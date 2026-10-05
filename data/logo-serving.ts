import inventory from "./reviewed-logo-inventory.json";

const reviewedFiles = new Map(inventory.map((row) => [row.file, row]));

/** Exact reviewed filenames only: no URLs, directories, decoding or arbitrary blob hashes. */
export function reviewedLogoFile(filename: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(filename) ? reviewedFiles.get(filename) ?? null : null;
}

/** UI's preferred DB route; keep the same reviewed public reference as its error fallback. */
export function databaseLogoPath(publicReference: string) {
  if (!publicReference.startsWith("/logos/")) return null;
  const file = publicReference.slice("/logos/".length);
  return reviewedLogoFile(file) ? `/api/logos/${file}` : null;
}
