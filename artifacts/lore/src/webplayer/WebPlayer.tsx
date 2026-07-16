import { useState } from "react";
import { Link } from "wouter";
import { Pause, Play, Check, RefreshCw, ChevronRight } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import { useLatestImportJob, useMyKeepStatus, useIsAuthenticated } from "../lib/meHooks";
import { useWpOnAir, useWpLoreCounts, type WpOnAirItem } from "./hooks";
import { LoreChip } from "./LoreChip";
import { WpKeep } from "./WpKeep";
import { RunDrawerSheet } from "./RunDrawerSheet";
import { AlbumLoreSheet } from "./AlbumLoreSheet";
import { LibraryTab } from "./LibraryTab";
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
  const { radio } = usePlayer();
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderBottom: "0.5px solid var(--wp-border)",
      }}
      data-testid={`wp-onair-${item.station.slug}`}
    >
      <button
        type="button"
        className="wp-play"
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
        {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
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
        <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
          {title}
          {item.show?.djName && (
            <span style={{ fontSize: 12, color: "var(--wp-text-muted)", fontWeight: 400 }}>
              {" "}
              · {item.show.djName}
            </span>
          )}
        </p>
        {item.now.resolved ? (
          <p style={{ margin: "2px 0 0", fontSize: 12, color: nowInLibrary ? "var(--wp-text-success)" : "var(--wp-text-secondary)" }}>
            now: {item.now.artist}
            {item.earlier.length > 0 && <> · earlier: {item.earlier.join(", ")}</>}
          </p>
        ) : (
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--wp-text-muted)" }}>
            {item.now.title ? `now: ${item.now.title}` : "resolving spins…"}
          </p>
        )}
      </button>
      <span
        className="wp-mono"
        style={{ fontSize: 11, color: "var(--wp-text-muted)", flexShrink: 0, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {item.station.name}
      </span>
      {authenticated ? (
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: item.matchCount ? "var(--wp-text-success)" : "var(--wp-text-muted)",
            flexShrink: 0,
            minWidth: 72,
            textAlign: "right",
          }}
        >
          {item.matchCount ? `${item.matchCount} matches` : "—"}
        </span>
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
  const { data: onAir, isLoading } = useWpOnAir();
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
        <div
          role="tablist"
          aria-label="Webplayer sections"
          style={{ display: "flex", gap: 6, margin: "20px 0 10px" }}
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
                ...(tab === key
                  ? {
                      background: "var(--wp-bg-accent)",
                      color: "var(--wp-text-accent)",
                      borderColor: "transparent",
                    }
                  : { color: "var(--wp-text-muted)" }),
              }}
              data-testid={`wp-tab-${key}`}
            >
              {label}
            </button>
          ))}
          {tab === "onair" && authenticated && (
            <p
              className="wp-mono"
              style={{
                margin: "0 0 0 auto",
                alignSelf: "center",
                fontSize: 11,
                color: "var(--wp-text-muted)",
              }}
            >
              {authenticated ? "sorted by your overlap" : "connect Spotify to sort by your taste"}
            </p>
          )}
        </div>

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
