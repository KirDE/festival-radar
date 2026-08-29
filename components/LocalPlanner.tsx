"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { parsePlannerState, serializePlannerState } from "@/lib/planner-storage";
export type Attendance = "going" | "maybe" | "not-going";
type State = {
  favoriteFestivals: string[];
  favoriteArtists: string[];
  attendance: Record<string, Attendance>;
  playlistFestivals: string[];
};
const empty: State = {
  favoriteFestivals: [],
  favoriteArtists: [],
  attendance: {},
  playlistFestivals: [],
};
const Context = createContext<
  | (State & {
      ready: boolean;
      toggleFestival: (v: string) => void;
      toggleArtist: (v: string) => void;
      setAttendance: (v: string, a?: Attendance) => void;
      togglePlaylistFestival: (v: string) => void;
      clear: () => void;
    })
  | null
>(null);
export function LocalPlannerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState(empty);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const value = localStorage.getItem("festival-radar-planner-v1");
      if (value) setState({ ...empty, ...parsePlannerState(value) });
    } catch {
      localStorage.removeItem("festival-radar-planner-v1");
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      localStorage.setItem("festival-radar-planner-v1", serializePlannerState(state));
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
      clear: () => setState(empty),
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
