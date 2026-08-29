import type { Festival } from "@/data/festivals";

export function festivalArtists(item: Festival) {
  return new Set([...item.headliners, ...item.lineup].map((artist) => artist.toLocaleLowerCase()));
}

export function lineupOverlap(items: Festival[]) {
  if (items.length < 2) return [];
  const [first, ...rest] = items.map(festivalArtists);
  return [...first].filter((artist) => rest.every((set) => set.has(artist))).sort();
}

export function similarFestivals(item: Festival, festivals: Festival[], limit = 3) {
  const artists = festivalArtists(item);
  return festivals.filter((candidate) => candidate.slug !== item.slug).map((candidate) => ({
    festival: candidate,
    shared: [...festivalArtists(candidate)].filter((artist) => artists.has(artist)).length,
  })).filter(({ shared }) => shared > 0).sort((a, b) => b.shared - a.shared || a.festival.name.localeCompare(b.festival.name)).slice(0, limit);
}

function compactDate(value: string) { return value.replaceAll("-", ""); }

export function calendarUrls(item: Festival) {
  if (!item.startDate) return null;
  const end = new Date(`${item.endDate || item.startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const exclusiveEnd = end.toISOString().slice(0, 10);
  const dates = `${compactDate(item.startDate)}/${compactDate(exclusiveEnd)}`;
  const details = `Official information: ${item.officialUrl}`;
  const query = new URLSearchParams({ action: "TEMPLATE", text: item.name, dates, details, location: [item.city, item.country].filter(Boolean).join(", ") });
  return {
    google: `https://calendar.google.com/calendar/render?${query}`,
    ics: `data:text/calendar;charset=utf-8,${encodeURIComponent(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Festival Radar//EN", "BEGIN:VEVENT", `UID:${item.slug}-2027@festival-radar`, `DTSTART;VALUE=DATE:${compactDate(item.startDate)}`, `DTEND;VALUE=DATE:${compactDate(exclusiveEnd)}`, `SUMMARY:${item.name}`, `LOCATION:${[item.city, item.country].filter(Boolean).join(", ")}`, `URL:${item.officialUrl}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n"))}`,
  };
}
