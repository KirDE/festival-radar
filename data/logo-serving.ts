import inventory from "./reviewed-logo-inventory.json" with { type: "json" };

const reviewedFiles = new Map(inventory.map((row) => [row.file, row]));

/** Exact reviewed filenames only: no URLs, directories, decoding or arbitrary blob hashes. */
export function reviewedLogoFile(filename: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*\.png$/.test(filename) ? reviewedFiles.get(filename) ?? null : null;
}

/** Build a DB URL only for an exact allowlisted filename. */
export function databaseLogoPath(filename: string) {
  return reviewedLogoFile(filename) ? `/api/logos/${filename}` : null;
}
