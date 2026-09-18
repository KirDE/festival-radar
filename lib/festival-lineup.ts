import type { Festival } from "@/data/festivals";

type FestivalLineup = Pick<Festival, "headliners" | "lineup">;

export function announcedArtists(item: FestivalLineup) {
  return [...item.headliners, ...item.lineup];
}

export function hasAnnouncedLineup(item: FestivalLineup) {
  return item.headliners.length + item.lineup.length > 0;
}

export function lineupPreviewArtists(item: FestivalLineup) {
  return item.headliners.length > 0 ? item.headliners : item.lineup;
}
