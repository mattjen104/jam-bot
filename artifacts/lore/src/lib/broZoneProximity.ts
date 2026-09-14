import type { DialStation } from "../hooks/useDialData";

export interface BroZoneOrigin {
  latitude: number;
  longitude: number;
}

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(value: number): number {
  return value * Math.PI / 180;
}

export function stationDistanceMiles(
  station: DialStation,
  origin: BroZoneOrigin,
): number | null {
  const { latitude, longitude, locationConfidence } = station.station;
  if (
    latitude == null
    || longitude == null
    || !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || locationConfidence == null
  ) return null;

  const latitudeDelta = toRadians(latitude - origin.latitude);
  const longitudeDelta = toRadians(longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const stationLatitude = toRadians(latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(stationLatitude)
    * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

export function sortBroZoneStationsByDistance(
  stations: readonly DialStation[],
  origin: BroZoneOrigin | null,
): DialStation[] {
  if (!origin) return [...stations];
  return [...stations].sort((a, b) => {
    const aDistance = stationDistanceMiles(a, origin);
    const bDistance = stationDistanceMiles(b, origin);
    if (aDistance == null && bDistance == null) return 0;
    if (aDistance == null) return 1;
    if (bDistance == null) return -1;
    return aDistance - bDistance || a.station.name.localeCompare(b.station.name);
  });
}