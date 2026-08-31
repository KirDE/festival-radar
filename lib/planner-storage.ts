type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, "going" | "maybe" | "not-going">;
  playlistFestivals: string[];
};

export function serializePlannerState(state: PlannerState) {
  return JSON.stringify(state);
}

export function parsePlannerState(value: string): Partial<PlannerState> {
  const parsed = JSON.parse(value) as Partial<PlannerState>;
  return {
    ...parsed,
    playlistFestivals: Array.isArray(parsed.playlistFestivals) ? parsed.playlistFestivals.filter((item): item is string => typeof item === "string") : [],
  };
}
