import { useQuery } from "@tanstack/react-query";

export type ExploreMode =
  | "location"
  | "station"
  | "artist"
  | "genre"
  | "newness"
  | "library-crossing";

export interface ExploreCandidate {
  station: {
    slug: string;
    name: string;
    city: string | null;
    region: string | null;
    latitude: number | null;
    longitude: number | null;
    approximateDistanceMiles: number | null;
  };
  show: {
    name: string;
    djName: string | null;
    startsAt: string | null;
    endsAt: string | null;
    live: boolean;
  } | null;
  primaryReason: { kind: string; text: string };
  evidence: {
    artistRecentPlays: number;
    libraryCrossings24h: number;
    genreMatch: "exact" | "adjacent" | "aggregate";
    profileGenres: Array<{ genre: string; count: number }>;
  };
  readiness: string;
  confidence: string;
  timing: {
    startsAt: string | null;
    endsAt: string | null;
    isLive: boolean;
  } | null;
}

export interface ExploreResponse {
  onAirNow: ExploreCandidate[];
  comingUp: ExploreCandidate[];
  showsToKnow: ExploreCandidate[];
  stations: ExploreCandidate[];
  metadata: {
    mode: ExploreMode;
    radiusMiles: number | null;
    partial: {
      schedules: boolean;
      genreEnrichment: boolean;
      coordinates: boolean;
      personalCrossings: boolean;
    };
    locality: { city: string; region: string; country: string } | null;
  };
}

export function useExplore(params: URLSearchParams | null) {
  const serialized = params?.toString() ?? "";
  return useQuery<ExploreResponse, Error>({
    queryKey: ["explore", serialized],
    queryFn: async () => {
      const response = await fetch(`/api/explore?${serialized}`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body &&
          typeof body.error === "string"
          ? body.error
          : "Couldn’t load Explore.";
        throw new Error(message);
      }
      return body as ExploreResponse;
    },
    enabled: Boolean(params),
    staleTime: 30_000,
  });
}