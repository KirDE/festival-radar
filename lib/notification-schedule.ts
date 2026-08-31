export type DigestFrequency = "DAILY" | "WEEKLY";

export function nextDigest(frequency: DigestFrequency, now = new Date()) {
  const date = new Date(now);
  date.setUTCHours(8, 0, 0, 0);
  if (frequency === "DAILY") {
    if (date <= now) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }
  const daysUntilMonday = (8 - date.getUTCDay()) % 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  if (date <= now) date.setUTCDate(date.getUTCDate() + 7);
  return date;
}
