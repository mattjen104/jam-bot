import { Link } from "wouter";
import { useQueries } from "@tanstack/react-query";
import {
  getStationArchive,
  getPickerArchive,
} from "@workspace/api-client-react";
import { useFollows, parseDjFollowId } from "../lib/local";
import { runDate } from "../lib/format";
import { ArrowUpRight, UserCheck } from "lucide-react";

interface StripItem {
  key: string;
  href: string;
  title: string;
  byline: string;
  date: string | null;
}

/**
 * A compact home-screen strip of the newest runs from followed sources.
 * Same client-side fan-out as the Following page (follows never leave the
 * device); renders nothing when the visitor follows no one.
 */
export function FollowingStrip() {
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

  if (follows.length === 0) return null;

  // Exactly ONE item per followed source — the newest run/list from each —
  // so no source can crowd the others out of the strip.
  const items: StripItem[] = [];
  stationQueries.forEach((q) => {
    const r = q.data?.runs[0];
    if (!q.data || !r) return;
    items.push({
      key: `station-run-${r.runId}`,
      href: `/archive/station-runs/${r.runId}`,
      title: r.show?.name ?? "Station stream",
      byline: q.data.station.name,
      date: r.date ?? null,
    });
  });
  djQueries.forEach((q, i) => {
    const f = djFollows[i];
    if (!q.data || !f) return;
    const parsed = parseDjFollowId(f.id);
    if (!parsed) return;
    const r = q.data.runs.find((r) => r.show?.djName === parsed.djName);
    if (!r) return;
    items.push({
      key: `dj-run-${r.runId}`,
      href: `/archive/station-runs/${r.runId}`,
      title: r.show?.name ?? "Station stream",
      byline: `${parsed.djName} · ${q.data.station.name}`,
      date: r.date ?? null,
    });
  });
  pickerQueries.forEach((q) => {
    const r = q.data?.runs[0];
    if (!q.data || !r) return;
    items.push({
      key: `picker-run-${r.runId}`,
      href: `/archive/picker-runs/${r.runId}`,
      title: r.title ?? "Untitled run",
      byline: q.data.picker.name,
      date: r.pickedAt ?? null,
    });
  });

  // Dedup (a station + its DJ follow can surface the same run), newest first.
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    const id = it.href;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const ts = (d: string | null): number => {
    if (!d) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(
      /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d,
    );
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  deduped.sort((a, b) => ts(b.date) - ts(a.date));
  const strip = deduped.slice(0, 8);

  if (strip.length === 0) return null;

  return (
    <section className="mb-8" data-testid="following-strip">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
          <UserCheck className="h-3.5 w-3.5" />
          From people you follow
        </h2>
        <Link
          href="/following"
          className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-primary"
          data-testid="link-following-all"
        >
          See all →
        </Link>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {strip.map((item) => (
          <li key={item.key} className="shrink-0">
            <Link
              href={item.href}
              className="hover-elevate flex w-[220px] flex-col gap-1 rounded-xl border border-card-border bg-card p-3"
              data-testid={`strip-${item.key}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-1 font-serif text-sm font-semibold text-foreground">
                  {item.title}
                </span>
                <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </span>
              <span className="line-clamp-1 font-mono text-[10px] text-muted-foreground">
                {item.byline}
                {item.date ? ` · ${runDate(item.date)}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
