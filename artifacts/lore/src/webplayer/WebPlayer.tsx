import { useEffect, useRef, useState } from "react";
import { proxyArtUrl } from "../lib/proxyArt";
import { Link, useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Check, RefreshCw, ChevronRight, Bookmark, Loader2, ScanLine, AudioLines, LibraryBig, Users, CalendarDays } from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import {
  useLatestImportJob,
  useMyKeepStatus,
  useIsAuthenticated,
  useMutationKeep,
  useMyPreferences,
} from "../lib/meHooks";
import { BottlePanel } from "../components/BottlePanel";
import { useStationPresence, type StationPresence } from "../hooks/useStationPresence";
import { useSocialMode } from "../lib/social";
import { useWpOnAir, useWpLoreCounts, type WpOnAirItem } from "./hooks";
import { LoreChip } from "./LoreChip";
import { WpKeep } from "./WpKeep";
import { RunDrawerSheet } from "./RunDrawerSheet";
import { WpCast } from "./WpCast";
import { AlbumLoreSheet } from "./AlbumLoreSheet";
import { LibraryTab } from "./LibraryTab";
import { rememberPrefersClassic } from "../lib/uiPrefs";
import { ForYouTab } from "./ForYouTab";
import { YourWeekTab } from "./YourWeekTab";
import { SelectorsTab } from "./SelectorsTab";
import { ScheduleTab } from "./ScheduleTab";
import "./wp.css";

// ---------------------------------------------------------------------------
// Bottom navigation — the app's four main sections (per approved mockup):
// ON AIR · LIBRARY · SELECTORS · SCHEDULE
// ---------------------------------------------------------------------------

type WpSection = "onair" | "library" | "selectors" | "schedule";

const NAV_ITEMS: Array<{ key: WpSection; label: string; icon: typeof AudioLines; path: string }> = [
  { key: "onair", label: "ON AIR", icon: AudioLines, path: "/player" },
  { key: "library", label: "LIBRARY", icon: LibraryBig, path: "/player/library" },
  { key: "selectors", label: "SELECTORS", icon: Users, path: "/player/selectors" },
  { key: "schedule", label: "SCHEDULE", icon: CalendarDays, path: "/player/schedule" },
];

function WpBottomNav({ section }: { section: WpSection }) {
  const [, navigate] = useLocation();
  return (
    <nav className="wp-bottomnav" aria-label="Main sections">
      {NAV_ITEMS.map(({ key, label, icon: Icon, path }) => {
        const active = section === key;
        return (
          <button
            key={key}
            type="button"
            className={`wp-bottomnav-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => navigate(path)}
            data-testid={`wp-nav-${key}`}
          >
            <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="wp-mono">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

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

  // During a preview-mode scan, display the scan hop's track instead of the
  // broadcast station. The scan exposes its current track in `scan.current`.
  const scanHop = scan.active ? scan.current : null;

  // nowMbid: prefer scan hop MBID when scanning, else the on-air MBID.
  const nowMbid = scanHop?.mbid ?? item?.now.mbid ?? null;
  const isAuthenticated = useIsAuthenticated();
  const { data: keptSet } = useMyKeepStatus(
    isAuthenticated && nowMbid ? [nowMbid] : [],
  );
  const inLibrary = nowMbid != null && keptSet?.has(nowMbid) === true;
  const { data: counts } = useWpLoreCounts(nowMbid ? [nowMbid] : []);

  // Render when a station is playing OR when a preview scan is active.
  if (!radio.station && !scan.active) return null;

  const showLabel = item?.show?.name ?? null;
  const dj = item?.show?.djName ?? null;

  // Build the track line: scan hop overrides station now-playing during scan.
  const trackLine = scanHop
    ? `${scanHop.title} · ${scanHop.artist}`
    : item
      ? `${item.now.title} · ${item.now.artist}`
      : radio.station?.name ?? "";

  // Station context line: during scan show the station being previewed.
  const stationLine = scanHop
    ? scanHop.stationName
    : showLabel ?? radio.station?.name ?? "";

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
        aria-label={radio.status === "playing" ? "Stop" : scan.active ? "Stop scan" : "Play"}
        onClick={() => {
          if (scan.active) {
            scan.toggle(); // stop scan — returns to idle
          } else {
            radio.toggle(radio.station!);
          }
        }}
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
        {radio.status === "playing" || scan.active ? (
          <Pause size={20} aria-hidden="true" />
        ) : (
          <Play size={20} aria-hidden="true" />
        )}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>
          {trackLine}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--wp-text-secondary)" }}>
          {stationLine}
          {!scanHop && showLabel && (
            <>
              {" "}
              <span style={{ color: "var(--wp-text-muted)" }}>· via</span>{" "}
              <span className="wp-mono" style={{ fontSize: 12 }}>
                {radio.station?.name}
              </span>
            </>
          )}
          {!scanHop && dj && (
            <>
              {" "}
              <span style={{ color: "var(--wp-text-muted)" }}>· selector</span> {dj}
            </>
          )}
          {scanHop && (
            <span className="wp-mono" style={{ fontSize: 11, color: "var(--wp-text-muted)", marginLeft: 6 }}>
              · preview
            </span>
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
          onOpen={() => onOpenLore(nowMbid, scanHop?.stationName ?? showLabel ?? radio.station!.name)}
        />
      )}
      {nowMbid && !inLibrary && !scanHop && radio.station && (
        <WpKeep mbid={nowMbid} provenance={{ kind: "station", stationSlug: radio.station.slug }} />
      )}
      {/* Scan controls — on/off toggle + direction flip */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        {scan.active && (
          <button
            type="button"
            onClick={scan.toggleDir}
            aria-label={scan.dir === 1 ? "Switch to backward scan" : "Switch to forward scan"}
            title={scan.dir === 1 ? "Scanning forward — click to reverse" : "Scanning backward — click to go forward"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "1.5px solid var(--wp-text-accent)",
              background: "var(--wp-bg-accent)",
              color: "var(--wp-text-accent)",
              fontFamily: "monospace",
              fontSize: 14,
              fontWeight: 600,
              padding: 0,
              cursor: "pointer",
            }}
          >
            {scan.dir === 1 ? "›" : "‹"}
          </button>
        )}
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
            padding: 0,
            cursor: "pointer",
          }}
        >
          <ScanLine size={16} aria-hidden="true" />
        </button>
      </div>
      <div style={{ flexBasis: "100%", minWidth: 0 }}>
        <WpCast />
      </div>
      {/* Bottle panel — message-in-a-bottle annotations anchored to the resolved MBID.
          Hidden during preview scans (no fixed station) and when MBID is unresolved. */}
      {nowMbid && !scanHop && item && (
        <BottlePanelWrapper
          mbid={nowMbid}
          stationId={item.station.id}
          stationName={item.station.name}
          trackTitle={item.now.title}
        />
      )}
    </div>
  );
}

/** Thin wrapper so BottlePanel (which uses hooks) can be conditionally mounted
 *  from JSX without violating the Rules of Hooks. */
function BottlePanelWrapper({
  mbid,
  stationId,
  stationName,
  trackTitle,
}: {
  mbid: string;
  stationId: number;
  stationName: string;
  trackTitle: string;
}) {
  return (
    <BottlePanel
      mbid={mbid}
      stationId={stationId}
      stationName={stationName}
      trackTitle={trackTitle}
    />
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
  presence,
  onOpenRun,
}: {
  item: WpOnAirItem;
  authenticated: boolean;
  nowInLibrary: boolean;
  /** Privacy-thresholded anonymous listener presence for this station. */
  presence?: StationPresence;
  onOpenRun: (slug: string) => void;
}) {
  const { radio, scan } = usePlayer();
  const { enabled: socialEnabled } = useSocialMode();
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
        onClick={() => {
          // Stop preview-mode scan before switching to a broadcast station.
          if (scan.active) scan.toggle();
          radio.toggle(item.station);
        }}
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
            {socialEnabled && presence != null && presence.count > 1 && (
              <span
                style={{ display: "inline-flex", alignItems: "center", fontSize: 10, color: "var(--wp-text-muted)", marginLeft: 5, opacity: 0.8 }}
                title={`${presence.count} anonymous listeners here now`}
              >
                {presence.avatars.length > 0 && (
                  <span aria-hidden="true" style={{ display: "inline-flex", marginRight: 4 }}>
                    {presence.avatars.map((avatar, index) => (
                      <img
                        key={`${avatar.artworkUrl}-${index}`}
                        src={proxyArtUrl(avatar.artworkUrl)!}
                        alt=""
                        width={15}
                        height={15}
                        style={{
                          width: 15,
                          height: 15,
                          objectFit: "cover",
                          borderRadius: 2,
                          marginLeft: index === 0 ? 0 : -4,
                          border: "1px solid var(--wp-card, white)",
                        }}
                      />
                    ))}
                  </span>
                )}
                · {presence.avatars.length > 0 ? "listening here" : `${presence.count} here`}
              </span>
            )}
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
// ---------------------------------------------------------------------------
// Attendance heartbeat — fires every 45 s while audio is playing and the
// tab is visible.  Stops on pause, station change, or page hide; resumes on
// un-hide.  Never throws — network errors are silently swallowed so a failed
// heartbeat never disrupts playback or the UI.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 45_000;

function useAttendanceHeartbeat(stationId: number | null, isPlaying: boolean) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const visibleRef = useRef(document.visibilityState === "visible");

  useEffect(() => {
    const handleVisibility = () => {
      visibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!stationId || !isPlaying) return;

    const send = () => {
      if (!visibleRef.current) return;
      fetch("/api/me/attendance/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stationId }),
        credentials: "include",
      }).catch(() => {
        // Silently ignore — a missed heartbeat is recoverable on the next tick.
      });
    };

    // Fire once immediately on mount (station start / visibility restore).
    send();
    timerRef.current = setInterval(send, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [stationId, isPlaying]);
}

export default function WebPlayer() {
  const { data: onAir, isLoading, dataUpdatedAt, refetch: refetchOnAir, isFetching: onAirFetching } = useWpOnAir();
  // Section is route-driven (/player, /player/library, /player/selectors,
  // /player/schedule) so each main section is deep-linkable.
  const [, navParams] = useRoute("/player/:tab");
  const rawTab = navParams?.tab ?? null;
  const section: WpSection =
    rawTab === "library" || rawTab === "selectors" || rawTab === "schedule"
      ? rawTab
      : "onair";
  // Within ON AIR, a secondary pill toggles the taste-ranked "For You" or "Your Week" view.
  const [onAirView, setOnAirView] = useState<"onair" | "foryou" | "yourweek">("onair");
  const tab = section === "onair" ? onAirView : section;
  const setTab = setOnAirView as (t: "onair" | "library" | "foryou" | "yourweek") => void;

  const { data: prefs } = useMyPreferences();
  const ledgerEnabled = prefs?.ledgerEnabled ?? false;
  const [runRef, setRunRef] = useState<{ slug: string; runId: number | null; context?: string } | null>(null);
  const [lore, setLore] = useState<{ mbid: string; spinningOn: string | null } | null>(null);

  const authenticated = onAir?.authenticated ?? false;
  const items = onAir?.items ?? [];
  const onAirMbids = items.map((i) => i.now.mbid).filter((m): m is string => m != null);
  const { data: onAirLore } = useWpLoreCounts(onAirMbids);

  // Station presence — `· N here` label on chips when > 1 listener is active.
  const onAirStationIds = items.map((i) => i.station.id);
  const presenceCounts = useStationPresence(onAirStationIds);

  // Attendance heartbeat — records that this listener was tuned while a spin
  // aired.  Only fires when audio is actually playing and the tab is visible.
  const { radio } = usePlayer();
  const heartbeatStationId = radio.station?.id ?? null;
  const heartbeatPlaying = radio.status === "playing";
  useAttendanceHeartbeat(heartbeatStationId, heartbeatPlaying);

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

        {/* ON AIR sub-tabs (For You lives inside the ON AIR section) */}
        <div style={{ margin: "20px 0 0" }}>
          {section === "onair" && (
          <div
            role="tablist"
            aria-label="On air views"
            style={{ display: "flex", gap: 6 }}
          >
            {(
              [
                ["onair", "On the air"],
                ["foryou", "For You"],
                ...(ledgerEnabled ? [["yourweek", "Your Week"] as const] : []),
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
          )}
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
                presence={presenceCounts.get(item.station.id)}
                onOpenRun={(slug) => setRunRef({ slug, runId: null })}
              />
            ))}
          </div>
        )}
        {tab === "library" && (
          <LibraryTab
            onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
            onOpenRun={(slug, runId) => setRunRef({ slug, runId, context: "library" })}
          />
        )}
        {tab === "foryou" && (
          <ForYouTab
            onOpenRun={(slug, runId) => setRunRef({ slug, runId })}
            onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
          />
        )}
        {tab === "yourweek" && ledgerEnabled && <YourWeekTab />}
        {section === "selectors" && (
          <SelectorsTab onOpenRun={(slug, runId) => setRunRef({ slug, runId })} />
        )}
        {section === "schedule" && (
          <ScheduleTab onOpenRun={(slug) => setRunRef({ slug, runId: null })} />
        )}
      </div>

      <WpBottomNav section={section} />

      {runRef && (
        <RunDrawerSheet
          slug={runRef.slug}
          runId={runRef.runId}
          onClose={() => setRunRef(null)}
          onOpenLore={(mbid) => setLore({ mbid, spinningOn: null })}
          context={runRef.context}
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
