/**
 * Reviewed geographic membership for the Bro Zones collection.
 *
 * Membership is deliberately read from the station payload; the client never
 * infers a zone from a station name or its listener's location. A station is
 * reviewed for this collection when its collections include `bro-zones`.
 */

export const BRO_ZONE_DEFINITIONS = [
  { key: "seattle", label: "Seattle" },
  { key: "portland", label: "Portland" },
  { key: "denver", label: "Denver" },
  { key: "cleveland", label: "Cleveland" },
  { key: "los-angeles", label: "Los Angeles" },
  { key: "redlands-inland-empire", label: "Redlands / Inland Empire" },
  { key: "washington-dc", label: "Washington DC" },
  { key: "north-carolina", label: "North Carolina" },
] as const;

export type BroZone = (typeof BRO_ZONE_DEFINITIONS)[number]["key"];
export const BRO_ZONE_KEYS = new Set<string>(BRO_ZONE_DEFINITIONS.map(({ key }) => key));
export const BRO_ZONES_COLLECTION = "bro-zones";

export interface BroZoneStation {
  slug?: string;
  collections?: readonly {
    slug: string;
    zone: string | null;
  }[] | null;
}
export type BroZoneCarrier = BroZoneStation | { station: BroZoneStation };

export function parseBroZones(search: string): Set<BroZone> {
  const params = new URLSearchParams(search);
  const raw = params.get("broZones") ?? params.get("broZone") ?? "";
  return new Set(
    raw.split(",").filter((value): value is BroZone => BRO_ZONE_KEYS.has(value)),
  );
}

export function parseBroZoneState(search: string): {
  active: boolean;
  regions: Set<BroZone>;
} {
  const params = new URLSearchParams(search);
  return {
    active: params.get("collection") === BRO_ZONES_COLLECTION,
    regions: parseBroZones(search),
  };
}

export function writeBroZones(params: URLSearchParams, selected: ReadonlySet<BroZone>): void {
  const ordered = BRO_ZONE_DEFINITIONS
    .map(({ key }) => key)
    .filter((key) => selected.has(key));
  if (ordered.length) params.set("broZones", ordered.join(","));
  else {
    params.delete("broZones");
    params.delete("broZone");
  }
}

export function writeBroZoneState(
  params: URLSearchParams,
  active: boolean,
  selected: ReadonlySet<BroZone>,
): void {
  if (active) params.set("collection", BRO_ZONES_COLLECTION);
  else params.delete("collection");
  writeBroZones(params, selected);
}

export function stationBroZones(carrier: BroZoneCarrier): Set<BroZone> {
  const station = "station" in carrier ? carrier.station : carrier;
  const values = (station.collections ?? [])
    .filter((collection) => collection.slug === "bro-zones")
    .map((collection) => collection.zone)
    .filter((zone): zone is string => zone != null);
  return new Set(values.filter((value): value is BroZone => BRO_ZONE_KEYS.has(value)));
}

export function isInBroZones(station: BroZoneCarrier, selected: ReadonlySet<BroZone>): boolean {
  if (!selected.size) return true;
  const membership = stationBroZones(station);
  return [...selected].some((zone) => membership.has(zone));
}

export function filterBroZones<T extends BroZoneCarrier>(
  stations: readonly T[],
  selected: ReadonlySet<BroZone>,
): T[] {
  return stations.filter((station) => isInBroZones(station, selected));
}

export function filterBroZoneCollection<T extends BroZoneCarrier>(
  stations: readonly T[],
  active: boolean,
  selected: ReadonlySet<BroZone>,
): T[] {
  if (!active) return [...stations];
  const eligible = selected.size
    ? stations.filter((station) => isInBroZones(station, selected))
    : stations.filter((station) => stationBroZones(station).size > 0);
  return eligible;
}

export function countBroZones<T extends BroZoneCarrier>(stations: readonly T[]): {
  combined: number;
  byZone: Record<BroZone, number>;
} {
  const byZone = Object.fromEntries(
    BRO_ZONE_DEFINITIONS.map(({ key }) => [key, 0]),
  ) as Record<BroZone, number>;
  let combined = 0;
  for (const station of stations) {
    const membership = stationBroZones(station);
    if (membership.size) combined++;
    for (const zone of membership) byZone[zone]++;
  }
  return { combined, byZone };
}