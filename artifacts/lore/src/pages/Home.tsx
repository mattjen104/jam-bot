import { useMemo, useState } from "react";
import {
  useListStations,
  useGetStationNowPlaying,
  getGetStationNowPlayingQueryKey,
  type Station,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { StationList } from "../components/StationList";
import { NowPlaying } from "../components/NowPlaying";
import { AudioLines, ShieldCheck, Waypoints } from "lucide-react";

export default function Home() {
  const { data, isLoading, isError } = useListStations();
  const { radio: player } = usePlayer();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const stations = useMemo(() => data?.stations ?? [], [data]);

  const activeSlug = player.station?.slug ?? null;
  const focusedSlug = selectedSlug ?? activeSlug;
  const focusedStation =
    stations.find((s) => s.slug === focusedSlug) ?? player.station ?? null;

  const { data: nowPlaying, isLoading: npLoading } = useGetStationNowPlaying(
    focusedSlug ?? "",
    {
      query: {
        queryKey: getGetStationNowPlayingQueryKey(focusedSlug ?? ""),
        enabled: !!focusedSlug,
        refetchInterval: 15000,
        refetchIntervalInBackground: false,
      },
    },
  );

  const handleSelect = (station: Station) => setSelectedSlug(station.slug);
  const handleToggle = (station: Station) => {
    setSelectedSlug(station.slug);
    void player.toggle(station);
  };

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div
        className={`relative z-10 mx-auto max-w-6xl px-4 pt-10 sm:px-6 ${
          player.station ? "pb-32" : "pb-16"
        }`}
      >
        <header className="mb-10">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <AudioLines className="h-4 w-4" />
            Lore Radio
          </div>
          <h1 className="mt-3 max-w-[18ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground sm:text-5xl">
            Live radio, tracked back to the source.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            A small, curated dial of high-quality stations. Each stream plays
            unmodified from its broadcaster — and every track is resolved to its
            canonical identity, with credits and deep links.
          </p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Unmodified streams
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Waypoints className="h-3.5 w-3.5 text-primary" /> Resolved to MusicBrainz
            </span>
            <span className="inline-flex items-center gap-1.5">
              <AudioLines className="h-3.5 w-3.5 text-primary" /> Attribution always
            </span>
          </div>
        </header>

        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-serif text-xl font-semibold text-foreground">
                The dial
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                {stations.length} station{stations.length === 1 ? "" : "s"}
              </span>
            </div>

            {isLoading && <StationListSkeleton />}
            {isError && (
              <div className="rounded-xl border border-destructive-border bg-destructive/10 p-4 text-sm text-destructive-foreground">
                Couldn't load the station directory. Please refresh.
              </div>
            )}
            {!isLoading && !isError && stations.length === 0 && (
              <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted-foreground">
                No stations are on the dial yet.
              </div>
            )}
            {!isLoading && stations.length > 0 && (
              <StationList
                stations={stations}
                activeSlug={activeSlug}
                status={player.status}
                onToggle={handleToggle}
                onSelect={handleSelect}
              />
            )}
          </section>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <NowPlaying
              data={nowPlaying}
              isLoading={npLoading}
              fallbackStation={focusedStation}
            />
          </aside>
        </div>

        <footer className="mt-16 border-t border-border pt-6 font-mono text-[11px] text-muted-foreground">
          Lore never hosts, proxies, or re-encodes audio. Streams are played
          directly from each broadcaster. Track identities and links are provided
          via MusicBrainz and partners.
        </footer>
      </div>
    </div>
  );
}

function StationListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 rounded-xl border border-card-border bg-card p-3"
        >
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}
