/** The official archive advertises the same edition in its title and hero.
 * Ignore incidental academic years, assets, copyright and article timestamps.
 * Require agreement so mixed/changed templates still follow normal review.
 */
export function isArchivedRockEnSeineDocument(html: string, editionYear: number): boolean {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const hero = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const advertisedYear = (value: string | undefined) => {
    const text = value?.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
    // Real homepage: Festival Rock en Seine - Du 26 au 30 août 2026.
    const match = text?.match(/\bRock\s+en\s+Seine\b[\s\S]*?\bdu\s+\d{1,2}\s+au\s+\d{1,2}\s+(?:août|aout|ao&ucirc;t)\s+(20\d{2})\b/i);
    return match ? Number(match[1]) : undefined;
  };
  const titleYear = advertisedYear(title);
  return titleYear !== undefined && titleYear < editionYear && titleYear === advertisedYear(hero);
}
