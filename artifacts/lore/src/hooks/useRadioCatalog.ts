import { useEffect, useState, useSyncExternalStore } from "react";
import type {
  RadioBrowseDecade,
  RadioBrowseFormat,
  RadioBrowseLens,
  RadioBrowseSort,
  RadioBrowseState,
  RadioBrowseStationType,
} from "../lib/radioBrowseState";
import { normalizeRadioArtistFocus } from "../lib/radioBrowseState";
import { readStationFollows, subscribeStationFollows } from "../lib/stationFollows";

export interface RadioCatalogItem {
  station: {
    slug: string;
    name: string;
    org: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
    streamUrl: string | null;
    stationType: RadioBrowseStationType;
    formats: string[];
    decades: RadioBrowseDecade[];
    broZones?: string[];
  };
  proximity: { verified: boolean; distanceMiles: number | null };
  evidence: {
    libraryCrossings: number;
    libraryArtistCrossings: number;
    discoveryScore: number | null;
  };
  score: number;
  explanation: string;
}

export interface RadioCatalogResponse {
  stations: RadioCatalogItem[];
  items: RadioCatalogItem[];
  metadata: {
    lens: RadioBrowseLens;
    sort: RadioBrowseSort;
    claim: string;
    eligibleCount: number;
    returnedCount: number;
    omittedUnknownLocation: number;
    filters: {
      stationTypes: RadioBrowseStationType[];
      formats: string[];
      decades: RadioBrowseDecade[];
      broZones?: string[];
    };
    semantics: { withinFamily: "or"; betweenFamilies: "and" };
    partial: { locality: boolean; personalization: boolean };
    locality: { city: string; region: string; country: string } | null;
    radiusMiles: number | null;
    personalCrossings: boolean;
  };
}

async function readCatalogPage(
  baseParams: URLSearchParams,
  offset: number,
  signal: AbortSignal,
): Promise<RadioCatalogResponse> {
  const params = new URLSearchParams(baseParams);
  params.set("offset", String(offset));
  const response = await fetch(`/api/explore?${params.toString()}`, { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body
      && typeof body.error === "string" ? body.error : "Couldn’t load the radio catalog.";
    throw new Error(message);
  }
  return body as RadioCatalogResponse;
}

/**
 * Join the bounded catalog response to the operational playback rows without
 * ever widening eligibility. The catalog list is authoritative; rows absent
 * from it cannot be reinserted by a client-side sort or filter.
 */
export function joinCatalogRows<T>(
  catalogSlugs: readonly string[],
  rows: readonly T[],
  slugOf: (row: T) => string,
  eligible: (row: T) => boolean = () => true,
): T[] {
  const bySlug = new Map(rows.map((row) => [slugOf(row), row]));
  return catalogSlugs
    .map((slug) => bySlug.get(slug))
    .filter((row): row is T => {
      if (!row) return false;
      return eligible(row);
    });
}

function csv(values: readonly string[]): string | null {
  return values.length ? [...values].sort().join(",") : null;
}

export function buildRadioCatalogParams(
  state: RadioBrowseState,
  hasTasteEvidence: boolean,
  followedSlugs: readonly string[] = [],
): URLSearchParams {
  const params = new URLSearchParams();
  // A local-first cold start has no origin yet. The catalog cannot honestly
  // rank it by proximity, so use its complete eligible catalog as Start here.
  const lens: RadioBrowseLens = state.lens === "local" && !state.locality
    ? "all"
    : state.lens;
  params.set("lens", lens);
  params.set("limit", "4");
  params.set("offset", String(Math.max(0, (state.page - 1) * 4)));
  const sort = lens === "local"
    ? state.sort
    : lens === "for-you"
      ? (state.sort === "best-match" || state.sort === "rarest-crossing" || state.sort === "recommended"
        ? state.sort : "recommended")
      : (state.sort === "recommended" || state.sort === "live-now" || state.sort === "name"
        ? state.sort : "recommended");
  params.set("sort", sort);
  if (state.locality?.zip) params.set("zip", state.locality.zip);
  if (state.locality?.city && state.locality.state) {
    params.set("city", state.locality.city);
    params.set("region", state.locality.state);
  }
  const artist = normalizeRadioArtistFocus(state.focusedArtist);
  if (lens === "for-you" && artist) params.set("artist", artist);
  const stationTypes = csv(state.filters.stationTypes);
  if (stationTypes) params.set("stationType", stationTypes);
  const formats = csv(state.filters.specialistFormats as readonly RadioBrowseFormat[]);
  if (formats) params.set("format", formats);
  const decades = csv(state.filters.decades as readonly RadioBrowseDecade[]);
  if (decades) params.set("decade", decades);
  const playingNow = csv(state.filters.playingNow);
  if (playingNow) params.set("playing", playingNow);
  const broZones = csv(state.filters.broZones);
  if (broZones) params.set("broZones", broZones);
  if (state.filters.followedOnly) {
    params.set("followed", "1");
    params.set("followedSlugs", [...followedSlugs].sort().join(","));
  }
  if (state.filters.supportOnly) params.set("support", "1");
  // The API's personalized read is only requested once taste evidence exists.
  if (lens === "for-you" && !hasTasteEvidence && !state.focusedArtist) params.set("lens", "all");
  return params;
}

export function useRadioCatalog(state: RadioBrowseState, hasTasteEvidence: boolean) {
  const followedSlugs = useSyncExternalStore(
    subscribeStationFollows,
    readStationFollows,
    () => new Set<string>(),
  );
  const params = buildRadioCatalogParams(state, hasTasteEvidence, [...followedSlugs]);
  const serialized = params.toString();
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: RadioCatalogResponse;
    error?: Error;
    loading: boolean;
  }>({ key: serialized, loading: true });
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setResult({ key: serialized, loading: true });
    void (async () => {
      // The server owns eligibility and ordering. Fetch only the requested
      // four-station page so the first view resolves without draining the
      // entire catalog.
      return await readCatalogPage(params, (state.page - 1) * 4, controller.signal);
    })()
      .then((data) => {
        if (!cancelled) setResult({ key: serialized, data, loading: false });
      })
      .catch((error: unknown) => {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setResult({ key: serialized, error: error instanceof Error ? error : new Error("Couldn’t load the radio catalog."), loading: false });
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serialized, retry]);
  return {
    data: result.key === serialized ? result.data : undefined,
    error: result.key === serialized ? result.error : undefined,
    isLoading: result.key !== serialized || result.loading,
    retry: () => setRetry((attempt) => attempt + 1),
  };
}