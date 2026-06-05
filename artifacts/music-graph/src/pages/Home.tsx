import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Loader2, Radio, AudioWaveform } from "lucide-react";
import {
  useResolveSong,
  getResolveSongQueryKey,
  useGetSongContext,
  getGetSongContextQueryKey,
  useHealthCheck,
} from "@workspace/api-client-react";
import { ForceGraph } from "@/components/ForceGraph";
import { Dossier } from "@/components/Dossier";
import { buildGraph, ANCHOR_ID, type GraphNode } from "@/lib/graph";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function readTrackParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("track");
}

function syncTrackParam(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("track", id);
  else url.searchParams.delete("track");
  window.history.replaceState({}, "", url.toString());
}

function errorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function errorMessage(err: unknown): { title: string; detail: string } {
  const status = errorStatus(err);
  if (status === 503)
    return {
      title: "Sources not connected",
      detail:
        "The enrichment backend needs Spotify credentials before it can resolve tracks. Provenance sources come online once the keys are set.",
    };
  if (status === 404)
    return {
      title: "No match found",
      detail: "Nothing resolved for that query. Try the artist and title together.",
    };
  if (status === 400)
    return { title: "Empty query", detail: "Type a song to begin." };
  return {
    title: "Something went wrong",
    detail: "The lookup failed. Try again in a moment.",
  };
}

function AnchorPlayer({
  html,
  name,
  spotifyUrl,
}: {
  html: string | null;
  name: string;
  spotifyUrl: string;
}) {
  if (html) {
    return (
      <div
        className="anchor-player"
        // The oEmbed payload is Spotify's own iframe markup.
        dangerouslySetInnerHTML={{ __html: html }}
        data-testid="anchor-player"
      />
    );
  }
  return (
    <div className="anchor-player flex flex-col items-center gap-2 p-4 text-center">
      <AudioWaveform className="h-6 w-6 text-primary" />
      <p className="font-mono text-sm">{name}</p>
      <a
        href={spotifyUrl}
        target="_blank"
        rel="noreferrer"
        className="text-xs text-primary underline-offset-2 hover:underline"
        data-testid="link-anchor-spotify"
      >
        Open on Spotify
      </a>
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [trackId, setTrackId] = useState<string | null>(() => readTrackParam());
  const [selectedId, setSelectedId] = useState<string | null>(ANCHOR_ID);

  const health = useHealthCheck();

  const resolve = useResolveSong(
    { q: query },
    {
      query: {
        enabled: query.trim().length > 0,
        queryKey: getResolveSongQueryKey({ q: query }),
        retry: false,
      },
    },
  );

  useEffect(() => {
    if (resolve.data?.id) {
      setTrackId(resolve.data.id);
      setSelectedId(ANCHOR_ID);
      syncTrackParam(resolve.data.id);
    }
  }, [resolve.data?.id]);

  const context = useGetSongContext(trackId ?? "", {
    query: {
      enabled: !!trackId,
      queryKey: getGetSongContextQueryKey(trackId ?? ""),
      retry: false,
    },
  });

  const graph = useMemo(
    () => (context.data ? buildGraph(context.data) : null),
    [context.data],
  );

  // Memoize the anchor player so simulation re-renders never reload the iframe.
  const anchorPlayer = useMemo(() => {
    if (!context.data) return null;
    return (
      <AnchorPlayer
        html={context.data.track.oEmbedHtml ?? null}
        name={context.data.track.name}
        spotifyUrl={context.data.track.spotifyUrl}
      />
    );
  }, [context.data?.track.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode: GraphNode | null = useMemo(() => {
    if (!graph) return null;
    return graph.nodes.find((n) => n.id === selectedId) ?? null;
  }, [graph, selectedId]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setQuery(q);
  };

  // Follow a thread: re-anchor the graph onto a related track/artist and update
  // the ?track= deep-link. A direct Spotify id navigates immediately; a free-text
  // target (similar artist, MB connection) routes through /song/resolve.
  const onTrace = ({ trackId: targetId, query: q }: { trackId?: string; query?: string }) => {
    if (targetId) {
      setTrackId(targetId);
      setSelectedId(ANCHOR_ID);
      syncTrackParam(targetId);
      return;
    }
    const next = q?.trim();
    if (!next) return;
    setInput(next);
    setQuery(next);
  };

  const isSearching = resolve.isLoading && resolve.fetchStatus !== "idle";
  const isLoadingContext = context.isLoading && context.fetchStatus !== "idle";
  const activeError = resolve.error ?? context.error;

  const hasTrack = !!trackId;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header health={health.data?.status} />

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_380px]">
        {/* Graph stage */}
        <main className="relative overflow-hidden border-r border-border/60">
          <div className="absolute inset-x-0 top-0 z-10 p-4">
            <SearchBar
              value={input}
              onChange={setInput}
              onSubmit={onSubmit}
              busy={isSearching}
            />
          </div>

          {!hasTrack && !isSearching && !activeError && <IdleState />}

          {(isSearching || isLoadingContext) && <LoadingState />}

          {activeError && !isSearching && !isLoadingContext && (
            <ErrorState {...errorMessage(activeError)} />
          )}

          {graph && context.data && !isLoadingContext && (
            <ForceGraph
              data={graph}
              selectedId={selectedId}
              onSelect={setSelectedId}
              anchorPlayer={anchorPlayer}
            />
          )}
        </main>

        {/* Dossier */}
        <aside className="hidden overflow-hidden bg-card/30 lg:block">
          {context.data ? (
            <Dossier
              context={context.data}
              selectedNode={selectedNode}
              onClearSelection={() => setSelectedId(ANCHOR_ID)}
              onTrace={onTrace}
            />
          ) : (
            <DossierPlaceholder />
          )}
        </aside>
      </div>
    </div>
  );
}

function Header({ health }: { health?: string }) {
  const online = health === "ok";
  return (
    <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Radio className="h-5 w-5" />
        </div>
        <div className="leading-tight">
          <h1 className="font-mono text-sm tracking-[0.18em]" data-testid="text-app-title">
            MUSIC GRAPH
          </h1>
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
            Provenance &amp; lineage
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
        <span
          className={`h-2 w-2 rounded-full ${online ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
          data-testid="status-backend"
        />
        {online ? "Backend live" : "Connecting"}
      </div>
    </header>
  );
}

function SearchBar({
  value,
  onChange,
  onSubmit,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-lg border border-border/70 bg-card/80 p-1.5 shadow-lg backdrop-blur"
      data-testid="form-search"
    >
      <Search className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      <Input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search a record — e.g. kashmir led zeppelin"
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        data-testid="input-search"
      />
      <Button type="submit" disabled={busy} className="gap-2" data-testid="button-search">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Trace"}
      </Button>
    </form>
  );
}

function IdleState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <AudioWaveform className="h-10 w-10 text-primary/70" />
      <h2 className="font-mono text-xl">Open a case file on any record</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Search a song to pull its players, pressings, lineage, and timed notes
        into an interactive graph. Drag nodes, follow the threads, and trace where
        a record came from.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
    </div>
  );
}

function ErrorState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="font-mono text-xl text-foreground" data-testid="text-error-title">
        {title}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function DossierPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="font-mono text-sm text-muted-foreground">No record loaded</p>
      <p className="text-xs text-muted-foreground/70">
        The dossier fills in once you trace a song.
      </p>
    </div>
  );
}
