import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import {
  getStationArchive,
  getPickerArchive,
} from "@workspace/api-client-react";
import { usePlayer } from "../player/PlayerProvider";
import { useFollows, toggleFollow, parseDjFollowId } from "../lib/local";
import { runDate } from "../lib/format";
import {
  ArrowLeft,
  ArrowUpRight,
  Ghost,
  Radio,
  UserCheck,
  Users,
  X,
} from "lucide-react";

/** One run from someone you follow, normalized for the merged feed. */
interface FeedItem {
  key: string;
  href: string;
  title: string;
  byline: string;
  sourceKind: "station" | "picker";
  date: string | null;
  trackCount: number;
  resolvedCount: number;
}

/**
 * The Following feed: new runs from the humans whose taste you borrowed.
 * Composed client-side from each followed archive — the follow list itself
 * never leaves this device.
 */
export default function Following() {
  const { ride, radio } = usePlayer();
  const follows = useFollows();
  const stationFollows = follows.filter((f) => f.kind === "station");
  const pickerFollows = follows.filter((f) => f.kind === "picker");
  const djFollows = follows.filter((f) => f.kind === "dj");

  const stationQueries = useQueries({
    queries: stationFollows.map((f) => ({
      queryKey: ["following", "station", f.id],
      queryFn: () => getStationArchive(f.id),
      staleTime: 60_000,
    })),
  });
  const pickerQueries = useQueries({
    queries: pickerFollows.map((f) => ({
      queryKey: ["following", "picker", f.id],
      queryFn: () => getPickerArchive(f.id),
      staleTime: 60_000,
    })),
  });
  // A followed DJ reads that station's archive, filtered to their shows below.
  const djQueries = useQueries({
    queries: djFollows.map((f) => {
      const parsed = parseDjFollowId(f.id);
      return {
        queryKey: ["following", "dj", f.id],
        queryFn: () => getStationArchive(parsed?.stationSlug ?? ""),
        staleTime: 60_000,
        enabled: !!parsed,
      };
    }),
  });

  const loading =
    stationQueries.some((q) => q.isLoading) ||
    pickerQueries.some((q) => q.isLoading) ||
    djQueries.some((q) => q.isLoading);

  const items: FeedItem[] = [];
  stationQueries.forEach((q, i) => {
    const f = stationFollows[i];
    if (!q.data || !f) return;
    for (const r of q.data.runs) {
      items.push({
        key: `station-run-${r.runId}`,
        href: `/archive/station-runs/${r.runId}`,
        title: r.show?.name ?? "Station stream",
        byline: r.show?.djName
          ? `${q.data.station.name} · ${r.show.djName}`
          : q.data.station.name,
        sourceKind: "station",
        date: r.date ?? null,
        trackCount: r.spinCount,
        resolvedCount: r.resolvedCount,
      });
    }
  });
  djQueries.forEach((q, i) => {
    const f = djFollows[i];
    if (!q.data || !f) return;
    const parsed = parseDjFollowId(f.id);
    if (!parsed) return;
    for (const r of q.data.runs) {
      if (r.show?.djName !== parsed.djName) continue;
      items.push({
        key: `dj-run-${r.runId}`,
        href: `/archive/station-runs/${r.runId}`,
        title: r.show?.name ?? "Station stream",
        byline: `${parsed.djName} · ${q.data.station.name}`,
        sourceKind: "station",
        date: r.date ?? null,
        trackCount: r.spinCount,
        resolvedCount: r.resolvedCount,
      });
    }
  });
  pickerQueries.forEach((q, i) => {
    const f = pickerFollows[i];
    if (!q.data || !f) return;
    for (const r of q.data.runs) {
      items.push({
        key: `selector-run-${r.runId}`,
        href: `/archive/selector-runs/${r.runId}`,
        title: r.title ?? "Untitled run",
        byline: q.data.picker.name,
        sourceKind: "picker",
        date: r.pickedAt ?? null,
        trackCount: r.trackCount,
        resolvedCount: r.resolvedCount,
      });
    }
  });
  // Normalize both date shapes (day-only "YYYY-MM-DD" and full ISO) to a
  // numeric timestamp so mixed formats sort correctly; day-only parses as UTC
  // midnight, dateless runs sink to the bottom.
  const ts = (d: string | null): number => {
    if (!d) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  items.sort((a, b) => ts(b.date) - ts(a.date));
  const feed = items.slice(0, 60);

  const dockPadding = ride.active || radio.station ? "pb-32" : "pb-16";

  return (
    <div className="min-h-screen">
      <div className={`mx-auto max-w-4xl px-4 pt-8 sm:px-6 ${dockPadding}`}>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the dial
        </Link>

        <header className="mb-8 mt-6">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            <UserCheck className="h-4 w-4" />
            Following
          </div>
          <h1 className="mt-3 max-w-[20ch] font-serif text-4xl font-semibold leading-[1.05] text-foreground">
            New runs from people you trust.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base text-muted-foreground">
            Follow the stations and selectors whose taste you keep coming back
            to — their newest documented runs gather here. Your follow list
            lives only on this device.
          </p>
        </header>

        {follows.length > 0 && (
          <div className="mb-8 flex flex-wrap gap-2" data-testid="follow-chips">
            {follows.map((f) => (
              <span
                key={`${f.kind}-${f.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1.5 font-mono text-[11px] text-foreground"
              >
                {f.kind === "station" ? (
                  <Radio className="h-3 w-3 text-primary" />
                ) : f.kind === "dj" ? (
                  <UserCheck className="h-3 w-3 text-primary" />
                ) : (
                  <Users className="h-3 w-3 text-primary" />
                )}
                <Link
                  href={
                    f.kind === "station"
                      ? `/archive/stations/${f.id}`
                      : f.kind === "dj"
                        ? `/archive/stations/${parseDjFollowId(f.id)?.stationSlug ?? ""}`
                        : `/archive/selectors/${f.id}`
                  }
                  className="hover:text-primary"
                >
                  {f.name}
                </Link>
                <button
                  type="button"
                  onClick={() => toggleFollow(f.kind, f.id, f.name)}
                  data-testid={`unfollow-${f.kind}-${f.id}`}
                  title={`Stop following ${f.name}`}
                  className="hover-elevate rounded-full p-0.5 text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {follows.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-8 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mx-auto mt-4 max-w-[36ch] font-serif text-lg text-muted-foreground">
              You're not following anyone yet. Find a station or selector whose
              taste you trust and hit Follow.
            </p>
            <Link
              href="/archive"
              className="hover-elevate mt-5 inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wide text-primary"
            >
              <Ghost className="h-3.5 w-3.5" />
              Browse the archives
            </Link>
          </div>
        ) : loading ? (
          <ul className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <li
                key={i}
                className="h-[74px] animate-pulse rounded-xl border border-card-border bg-card"
              />
            ))}
          </ul>
        ) : feed.length === 0 ? (
          <p className="rounded-xl border border-card-border bg-card p-4 font-mono text-xs text-muted-foreground">
            Nothing documented from your people yet — runs appear as their
            archives fill in.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="following-feed">
            {feed.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="hover-elevate flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card p-4"
                  data-testid={`feed-${item.key}`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-serif text-base font-semibold text-foreground">
                      {item.title}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {item.sourceKind === "station" ? "" : ""}
                      {item.byline}
                      {item.date ? ` · ${runDate(item.date)}` : ""} ·{" "}
                      {item.trackCount} track{item.trackCount === 1 ? "" : "s"} ·{" "}
                      <span className={item.resolvedCount > 0 ? "text-primary" : ""}>
                        {item.resolvedCount}/{item.trackCount} resolved
                      </span>
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
