import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Check, RefreshCw, ChevronRight, Bookmark, Loader2, ScanLine } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  useLatestImportJob,
  useMyKeepStatus,
  useIsAuthenticated,
  useMutationKeep,
} from "../lib/meHooks";
import { useWpOnAir, useWpLoreCounts, type WpOnAirItem } from "./hooks";
import { LoreChip } from "./LoreChip";
import { WpKeep } from "./WpKeep";
import { RunDrawerSheet } from "./RunDrawerSheet";
import { WpCast } from "./WpCast";
import { AlbumLoreSheet } from "./AlbumLoreSheet";
import { LibraryTab } from "./LibraryTab";
import { rememberPrefersClassic } from "../lib/uiPrefs";
import { ForYouTab } from "./ForYouTab";
import "./wp.css";

/** Now-playing hero card: the station currently sounding via the radio player. */
function NowPlayingCard({
  onAir,
  onOpenLore,
}: {
  onAir: WpOnAirItem[];
  onOpenLore: (mbid: string, spinningOn: string | null) => void;
}) {
  const { radio, scan } = usePlayer();
  const playingSlug = radio.station?.slug ?? null;
  const item = playingSlug ? onAir.find((i) => i.station.slug === playingSlug) : null;

  const nowMbid = item?.now.mbid ?? null;
  const isAuthenticated = useIsAuthenticated();
  const { data: keptSet } = useMyKeepStatus(
    isAuthenticated && nowMbid ? [nowMbid] : [],
  );
  const inLibrary = nowMbid != null && keptSet?.has(nowMbid) === true;
  const { data: counts } = useWpLoreCounts(nowMbid ? [nowMbid] : []);

  if (!radio.station) return null;

  const showLabel = item?.show?.name ?? null;
  const dj = item?.show?.djName ?? null;

  return (
    <div
      className="wp-card"
      style={{
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 14,
        flexWrap: "wrap",
      }}
      data-testid="wp-now-playing"
    >
      <button
        type="button"
        aria-label={radio.status === "playing" ? "Stop" : "Play"}
        onClick={() => radio.toggle(radio.station!)}
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "var(--wp-fill-primary)",
          color: "var(--wp-on-primary)",
          border: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          padding: 0,
        }}
      >
        {radio.status === "playing" ? (
          <Pause size={20} aria-hidden="true" />
        ) : (
          <Play size={20} aria-hidden="true" />
        )}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
          {item ? `${item.now.title} · ${item.now.artist}` : radio.station.name}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--wp-text-secondary)" }}>
          {showLabel ?? radio.station.name}
          {showLabel && (
            <>
              {" "}
              <span style={{ color: "var(--wp-text-muted)" }}>· via</span>{" "}
              <span className="wp-mono" style={{ fontSize: 12 }}>
                {radio.station.name}
              </span>
            </>
          )}
          {dj && (
            <>
              {" "}
              <span style={{ color: "var(--wp-text-muted)" }}>· selector</span> {dj}
            </>
          )}
        </p>
      </div>
      {inLibrary && (
        <span
          className="wp-pill"
          style={{
            background: "var(--wp-bg-success)",
            color: "var(--wp-text-success)",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Check size={13} aria-hidden="true" /> in your library
        </span>
      )}
      {nowMbid && (
        <LoreChip
          count={counts?.get(nowMbid)}
          onOpen={() => onOpenLore(nowMbid, showLabel ?? radio.station!.name)}
        />
      )}
      {nowMbid && !inLibrary && (
        <WpKeep mbid={nowMbid} provenance={{ kind: "station", stationSlug: radio.station.slug }} />
      )}
      {/* Scan toggle — single on/off like a car radio */}
      <button
        type="button"
        onClick={scan.toggle}
        aria-label={scan.active ? "Stop scanning" : "Scan stations"}
        title={scan.active ? "Stop scanning" : "Scan through all stations"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: scan.active ? "1.5px solid var(--wp-text-accent)" : "1.5px solid var(--wp-border)",
          background: scan.active ? "var(--wp-bg-accent)" : "none",
          color: scan.active ? "var(--wp-text-accent)" : "var(--wp-text-muted)",
          flexShrink: 0,
          padding: 0,
          cursor: "pointer",
        }}
      >
        <ScanLine size={16} aria-hidden="true" />
      </button>
      <div style={{ flexBasis: "100%", minWidth: 0 }}>
        <WpCast />
      </div>
    </div>
  );
}

/** Import progress strip — visible while a Spotify library import runs. */
function ImportStrip() {
  const { data: job } = useLatestImportJob();
  if (!job || (job.status !== "running" && job.status !== "pending")) return null;

  const pct = job.total > 0 ? Math.round((100 * job.resolved) / job.total) : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        margin: "12px 0 20px",
        padding: "10px 16px",
        background: "var(--wp-bg-accent)",
        borderRadius: "var(--wp-radius)",
      }}
      data-testid="wp-import-strip"
    >
      <RefreshCw size={16} style={{ color: "var(--wp-text-accent)", flexShrink: 0 }} aria-hidden="true" />
      <p style={{ margin: 0, fontSize: 13, color: "var(--wp-text-accent)", flex: 1 }}>
        Reading your Spotify library · {job.resolved.toLocaleString()} /{" "}
        {job.total.toLocaleString()} tracks resolved — matches below update as we go
      </p>
      <div
        style={{
          width: 120,
          height: 4,
          background: "var(--wp-surface-2)",
          borderRadius: 2,
          overflow: "hidden",
          flexShrink: 0,
        }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--wp-fill-accent)" }} />
      </div>
    </div>
  );
}

/** Ticking "updated Xs ago" freshness label for the on-air list. */
function OnAirFreshness({ updatedAt }: { updatedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);
  if (!updatedAt) return null;
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const label = secs < 15 ? "just now" : secs < 90 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  return (
    <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-muted)" }} data-testid="wp-onair-freshness">
      updated {label}
    </span>
  );
}

/**
 * Compact keep control for on-air rows. Kept state comes from the batched
 * lore-counts data (no per-row status query); an optimistic local flag flips
 * the control immediately on success.
 */
function OnAirKeep({
  mbid,
  stationSlug,
  inLibrary,
}: {
  mbid: string;
  stationSlug: string;
  inLibrary: boolean;
}) {
  const queryClient = useQueryClient();
  const keepMutation = useMutationKeep();
  const [justKept, setJustKept] = useState(false);
  const kept = inLibrary || justKept;

  if (kept) {
    return (
      <span
        title="In your library"
        style={{ display: "inline-flex", alignItems: "center", color: "var(--wp-text-success)", flexShrink: 0 }}
        data-testid={`wp-onair-kept-${mbid}`}
      >
        <Check size={14} aria-hidden="true" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        keepMutation.mutate(
          { mbid, provenance: { kind: "station", stationSlug } },
          {
            onSuccess: () => {
              setJustKept(true);
              // Refresh keptSince so green in-library highlights pick up.
              void queryClient.invalidateQueries({ queryKey: ["wp", "lore-counts"] });
            },
          },
        )
      }
      disabled={keepMutation.isPending}
      title="Keep this track in your library"
      aria-label="Keep this track in your library"
      style={{ display: "inline-flex", alignItems: "center", padding: "4px 7px", fontSize: 12, flexShrink: 0 }}
      data-testid={`wp-onair-keep-${mbid}`}
    >
      {keepMutation.isPending ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : (
        <Bookmark size={13} aria-hidden="true" />
      )}
    </button>
  );
}

function OnAirRow({
  item,
  authenticated,
  nowInLibrary,
  onOpenRun,
}: {
  item: WpOnAirItem;
  authenticated: boolean;
  nowInLibrary: boolean;
  onOpenRun: (slug: string) => void;
}) {
  const { radio } = usePlayer();
  const isPlaying = radio.station?.slug === item.station.slug && radio.status !== "idle";
  const title = item.show?.name ?? item.station.name;
  // When a show name is the title, keep the station as context; otherwise the
  // trailing station label would just repeat the title — hide it.
  const stationContext = item.show?.name ? item.station.name : null;
  const oneLine: React.CSSProperties = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px",
        borderBottom: "0.5px solid var(--wp-border)",
      }}
      data-testid={`wp-onair-${item.station.slug}`}
    >
      <button
        type="button"
        className="wp-play wp-play-sm"
        aria-label={`${isPlaying ? "Stop" : "Play"} ${title}`}
        onClick={() => radio.toggle(item.station)}
        style={
          isPlaying
            ? {
                background: "var(--wp-fill-primary)",
                color: "var(--wp-on-primary)",
                border: "none",
              }
            : undefined
        }
      >
        {isPlaying ? <Pause size={12} aria-hidden="true" /> : <Play size={12} aria-hidden="true" />}
      </button>
      <button
        type="button"
        onClick={() => onOpenRun(item.station.slug)}
        style={{
          minWidth: 0,
          flex: 1,
          background: "none",
          border: "none",
          padding: 0,
          borderRadius: 6,
          textAlign: "left",
          cursor: "pointer",
        }}
        aria-label={`Open tonight's run for ${title}`}
      >
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, ...oneLine }}>
          {title}
          {item.show?.djName && (
            <span style={{ fontSize: 11, color: "var(--wp-text-muted)", fontWeight: 400 }}>
              {" "}
              · {item.show.djName}
            </span>
          )}
          {stationContext && (
            <span className="wp-mono" style={{ fontSize: 10, color: "var(--wp-text-muted)", fontWeight: 400 }}>
              {" "}
              · {stationContext}
            </span>
          )}
        </p>
        {item.now.resolved ? (
          <p style={{ margin: "1px 0 0", fontSize: 12, color: nowInLibrary ? "var(--wp-text-success)" : "var(--wp-text-secondary)", ...oneLine }}>
            {item.now.artist}
          </p>
        ) : (
          <p style={{ margin: "1px 0 0", fontSize: 12, color: "var(--wp-text-muted)", ...oneLine }}>
            {item.now.title ?? "resolving spins…"}
          </p>
        )}
      </button>
      {authenticated && item.now.resolved && item.now.mbid && (
        <OnAirKeep
          // Key by mbid: remounting on track change resets the optimistic
          // justKept flag so a new track never inherits kept state.
          key={item.now.mbid}
          mbid={item.now.mbid}
          stationSlug={item.station.slug}
          inLibrary={nowInLibrary}
        />
      )}
      {authenticated ? (
        item.matchCount ? (
          <span
            className="wp-mono"
            style={{ fontSize: 11, fontWeight: 500, color: "var(--wp-text-success)", flexShrink: 0 }}
            title={`${item.matchCount} matches with your taste`}
          >
            {item.matchCount}✦
          </span>
        ) : null
      ) : (
        <ChevronRight size={14} style={{ color: "var(--wp-text-muted)", flexShrink: 0 }} aria-hidden="true" />
      )}
    </div>
  );
}

/**
 * Consolidated webplayer home (/player): now-playing hero, import progress,
 * and the on-air list sorted by library overlap. Run drawer and album lore
 * panel open as bottom sheets.
 */
export default function WebPlayer() {
  const { data: onAir, isLoading, dataUpdatedAt, refetch: refetchOnAir, isFetching: onAirFetching } = useWpOnAir();
  const [tab, setTab] = useState<"onair" | "library" | "foryou">("onair");
  const [runRef, setRunRef] = useState<{ slug: string; runId: number | null } | null>(null);
  const [lore, setLore] = useState<{ mbid: string; spinningOn: string | null } | null>(null);

  const authenticated = onAir?.authenticated ?? false;
  const items = onAir?.items ?? [];
  const onAirMbids = items.map((i) => i.now.mbid).filter((m): m is string => m != null);
  const { data: onAirLore } = useWpLoreCounts(onAirMbids);

  return (
    <div className="wp" data-testid="webplayer">
      <div className="wp-wrap">
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18 }}>
            <span style={{ color: "var(--wp-text-accent)" }}>●</span> Lore{" "}
            <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-muted)" }}>
              PLAYER
            </span>
          </h1>
          <Link
            href="/"
            className="wp-mono"
            style={{ fontSize: 11, color: "var(--wp-text-muted)", textDecoration: "none" }}
            data-testid="wp-back-to-classic"
            onClick={() => rememberPrefersClassic()}
          >
            CLASSIC SITE →
          </Link>
        </div>

        <NowPlayingCard
          onAir={items}
          onOpenLore={(mbid, spinningOn) => setLore({ mbid, spinningOn })}
        />

        <ImportStrip />

        {/* Tabs */}
        <div style={{ margin: "20px 0 0" }}>
          <div
            role="tablist"
            aria-label="Webplayer sections"
            style={{ display: "flex", gap: 6 }}
          >
            {(
              [
                ["onair", "On the air"],
                ["library", "Library"],
                ["foryou", "For You"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className="wp-mono"
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  padding: "7px 14px",
                  borderColor: "transparent",
                  ...(tab === key
                    ? {
                        background: "var(--wp-bg-accent)",
                        color: "var(--wp-text-accent)",
                      }
                    : { color: "var(--wp-text-muted)" }),
                }}
                data-testid={`wp-tab-${key}`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "onair" && (
            <p
              className="wp-mono"
              style={{
                margin: "6px 0 0",
                fontSize: 11,
                color: "var(--wp-text-muted)",
                display: "flex",
                gap: 10,
              }}
            >
              {authenticated && <span>sorted by your overlap</span>}
              {!isLoading && <OnAirFreshness updatedAt={dataUpdatedAt} />}
              <button
                type="button"
                onClick={() => void refetchOnAir()}
                disabled={onAirFetching}
                title="Refresh now"
                aria-label="Refresh on-air list"
                style={{
                  display: "inline-flex",
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "var(--wp-text-muted)",
                  cursor: onAirFetching ? "default" : "pointer",
                }}
              >
                <RefreshCw
                  size={11}
                  className={onAirFetching ? "animate-spin" : ""}
                  aria-hidden="true"
                />
              </button>
            </p>
          )}
        </div>
        <div style={{ marginBottom: 10 }} />

        {tab === "onair" && (
          <div className="wp-card" style={{ overflow: "hidden" }}>
            {isLoading && (
              <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
                Tuning across the dial…
              </p>
            )}
            {!isLoading && items.length === 0 && (
              <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
                Nothing on the air right now — stations appear here as they log spins.
              </p>
            )}
            {items.map((item) => (
              <OnAirRow
                key={item.station.slug}
                item={item}
                authenticated={authenticated}
                nowInLibrary={
                  item.now.mbid != null &&
                  (onAirLore?.get(item.now.mbid)?.keptSince ?? null) != null
                }
                onOpenRun={(slug) => setRunRef({ slug, runId: null })}
              />
            ))}
          </div>
        )}
        {tab === "library" && (
          <LibraryTab
            onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
            onOpenRun={(slug, runId) => setRunRef({ slug, runId })}
          />
        )}
        {tab === "foryou" && (
          <ForYouTab
            onOpenRun={(slug, runId) => setRunRef({ slug, runId })}
            onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
          />
        )}
      </div>

      {runRef && (
        <RunDrawerSheet
          slug={runRef.slug}
          runId={runRef.runId}
          onClose={() => setRunRef(null)}
          onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
        />
      )}
      {lore && (
        <AlbumLoreSheet
          mbid={lore.mbid}
          spinningOn={lore.spinningOn}
          onClose={() => setLore(null)}
        />
      )}
    </div>
  );
}
