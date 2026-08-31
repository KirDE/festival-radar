import type { Festival } from "../data/festivals.ts";

export type Coordinates = { latitude: number; longitude: number };
export type FestivalFilters = { genre?: string; origin?: Coordinates; maxDistanceKm?: number };

const earthRadiusKm = 6371;

export function distanceKm(from: Coordinates, to: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const latitudeA = radians(from.latitude);
  const latitudeB = radians(to.latitude);
  const haversine = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

export function normalizeGenre(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function festivalMatchesDiscoveryFilters(festival: Festival, filters: FestivalFilters) {
  if (filters.genre && !festival.genres.map(normalizeGenre).includes(normalizeGenre(filters.genre))) return false;
  if (filters.maxDistanceKm !== undefined) {
    if (!filters.origin || !festival.coordinates) return false;
    if (distanceKm(filters.origin, festival.coordinates) > filters.maxDistanceKm) return false;
  }
  return true;
}

export function festivalGenres(items: Festival[]) {
  return [...new Set(items.flatMap((item) => item.genres.map(normalizeGenre)))].sort();
}
