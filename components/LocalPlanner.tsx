"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
export type Attendance = "going" | "maybe" | "not-going";
export type PlannerState = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, Attendance>;
  playlistFestivals: string[];
  savedFilters: { query: string; country: string; announcedOnly: boolean; month: string; ticketsOnly: boolean };
};
export const emptyPlannerState: PlannerState = {
  favoriteFestivals: [],
  favoriteArtists: [],
  attendance: {},
  playlistFestivals: [],
  savedFilters: { query: "", country: "all", announcedOnly: false, month: "all", ticketsOnly: false },
};
const Context = createContext<
  | (PlannerState & {
      ready: boolean;
      toggleFestival: (v: string) => void;
      toggleArtist: (v: string) => void;
      setAttendance: (v: string, a?: Attendance) => void;
      togglePlaylistFestival: (v: string) => void;
      setSavedFilters: (value: PlannerState["savedFilters"]) => void;
      replace: (value: PlannerState) => void;
      merge: (value: Partial<PlannerState>) => void;
      clear: () => void;
    })
  | null
>(null);
export function LocalPlannerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState(emptyPlannerState);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const value = localStorage.getItem("festival-radar-planner-v1");
      if (value) setState({ ...emptyPlannerState, ...JSON.parse(value) });
    } catch {
      localStorage.removeItem("festival-radar-planner-v1");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      localStorage.setItem("festival-radar-planner-v1", JSON.stringify(state));
  }, [ready, state]);
  const toggle = (a: string[], v: string) =>
    a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  const value = useMemo(
    () => ({
      ...state,
      ready,
      toggleFestival: (v: string) =>
        setState((s) => ({
          ...s,
          favoriteFestivals: toggle(s.favoriteFestivals, v),
        })),
      toggleArtist: (v: string) =>
        setState((s) => ({
          ...s,
          favoriteArtists: toggle(s.favoriteArtists, v),
        })),
      setAttendance: (v: string, a?: Attendance) =>
        setState((s) => {
          const attendance = { ...s.attendance };
          if (a) attendance[v] = a;
          else delete attendance[v];
          return { ...s, attendance };
        }),
      togglePlaylistFestival: (v: string) =>
        setState((s) => ({
          ...s,
          playlistFestivals: toggle(s.playlistFestivals, v),
        })),
      setSavedFilters: (savedFilters: PlannerState["savedFilters"]) => setState((s) => ({ ...s, savedFilters })),
      replace: (next: PlannerState) => setState({ ...emptyPlannerState, ...next }),
      merge: (next: Partial<PlannerState>) => setState((current) => ({
        favoriteFestivals: Array.from(new Set([...current.favoriteFestivals, ...(next.favoriteFestivals || [])])),
        favoriteArtists: Array.from(new Set([...current.favoriteArtists, ...(next.favoriteArtists || [])])),
        attendance: { ...(next.attendance || {}), ...current.attendance },
        playlistFestivals: Array.from(new Set([...current.playlistFestivals, ...(next.playlistFestivals || [])])),
        savedFilters: { ...current.savedFilters, ...(next.savedFilters || {}) },
      })),
      clear: () => setState(emptyPlannerState),
    }),
    [ready, state],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useLocalPlanner() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing LocalPlannerProvider");
  return value;
}
export function FavoriteButton({
  kind,
  value,
}: {
  kind: "festival" | "artist";
  value: string;
}) {
  const p = useLocalPlanner();
  const selected = (
    kind === "festival" ? p.favoriteFestivals : p.favoriteArtists
  ).includes(value);
  return (
    <button
      className={`favoriteButton${selected ? " selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={() =>
        kind === "festival" ? p.toggleFestival(value) : p.toggleArtist(value)
      }
    >
      {selected ? "★ Saved" : "☆ Save"}
    </button>
  );
}
