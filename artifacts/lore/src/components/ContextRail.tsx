/**
 * ContextRail — sticky bottom strip on deep views (station / show / DJ).
 *
 * Renders horizontally scrollable chips grouped by entity type. Tapping a
 * station chip navigates laterally; library chip goes to /library; artist /
 * album chips show a toast (future entity pages).
 */
import { useLocation } from "wouter";
import type { ReactNode } from "react";
import type { DialStation, DialShow } from "../hooks/useDialData";

interface ContextRailProps {
  level: "station" | "show" | "dj";
  station: DialStation | null;
  show: DialShow | null;
  djName: string | null;
  allStations: DialStation[];
  onStationClick: (slug: string) => void;
  onDjClick: (name: string) => void;
}

function Chip({
  label,
  variant,
  onClick,
}: {
  label: string;
  variant?: "lib" | "sel" | "live" | "new" | "default";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`ctx-chip ctx-chip--${variant ?? "default"}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span className="ctx-sep" aria-hidden="true" />;
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ctx-grp">
      <span className="ctx-grp-lbl">{label}</span>
      {children}
    </div>
  );
}

export function ContextRail({
  level,
  station,
  show,
  djName,
  allStations,
  onStationClick,
  onDjClick,
}: ContextRailProps) {
  const [, setLocation] = useLocation();

  function showToast(msg: string) {
    // Simple ephemeral toast using existing Toaster infrastructure
    const el = document.createElement("div");
    el.style.cssText = `position:fixed;bottom:140px;left:50%;transform:translateX(-50%);
      background:var(--raised,#202020);border:1px solid var(--rule-strong,#444444);border-radius:3px;
      font-family:var(--app-font-display,'Archivo Narrow',sans-serif);font-size:10px;text-transform:uppercase;
      letter-spacing:.07em;color:var(--ink-2,#b2b2b2);padding:9px 16px;white-space:nowrap;z-index:9999;
      pointer-events:none`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  const parts: ReactNode[] = [];

  if (level === "show" && show) {
    // Collect artist → artistMbid (preferred) or recording mbid (fallback) for navigation
    const artistNavMbid = new Map<string, { artistMbid: string | null; recordingMbid: string | null }>();
    for (const sp of show.spins) {
      if (!artistNavMbid.has(sp.artist)) {
        artistNavMbid.set(sp.artist, { artistMbid: sp.artistMbid ?? null, recordingMbid: sp.mbid ?? null });
      }
    }
    const yourArtists = [...new Set(show.spins.filter((s) => s.isLibraryHit).map((s) => s.artist))].slice(0, 4);
    const newArtists = [...new Set(show.spins.filter((s) => !s.isLibraryHit).map((s) => s.artist))]
      .filter((a) => !yourArtists.includes(a))
      .slice(0, 2);

    function artistClickHandler(name: string) {
      const nav = artistNavMbid.get(name);
      if (nav?.artistMbid) return () => setLocation(`/artist/${nav.artistMbid}`);
      if (nav?.recordingMbid) return () => setLocation(`/song/${nav.recordingMbid}`);
      return () => showToast("No page available yet");
    }

    if (yourArtists.length > 0 || newArtists.length > 0) {
      parts.push(
        <Group key="artists" label="Artists">
          {yourArtists.map((a) => (
            <Chip key={a} label={a} variant="lib" onClick={artistClickHandler(a)} />
          ))}
          {newArtists.map((a) => (
            <Chip key={a} label={a} variant="new" onClick={artistClickHandler(a)} />
          ))}
        </Group>,
      );
    }

    // Albums — deduplicated album info if available
    const albumsFromSpins: string[] = [];
    parts.push(<Sep key="sep1" />);
    if (albumsFromSpins.length > 0) {
      parts.push(
        <Group key="albums" label="Albums">
          {albumsFromSpins.slice(0, 3).map((al) => (
            <Chip key={al} label={al} onClick={() => showToast("Album pages coming soon")} />
          ))}
        </Group>,
      );
      parts.push(<Sep key="sep2" />);
    }

    const isPicker = show.isPickerShow;
    parts.push(
      <Group key="selector" label="Selector">
        {show.djName ? (
          <Chip
            label={show.djName}
            variant={isPicker ? "sel" : "default"}
            onClick={() => onDjClick(show.djName!)}
          />
        ) : null}
      </Group>,
    );

    if (station) {
      parts.push(<Sep key="sep3" />);
      parts.push(
        <Group key="station" label="Station">
          <Chip
            label={station.station.name}
            variant="live"
            onClick={() => onStationClick(station.station.slug)}
          />
        </Group>,
      );
    }

    if (show.crossings > 0) {
      parts.push(<Sep key="sep4" />);
      parts.push(
        <Group key="library" label="Library">
          <Chip
            label={`◆ ${show.crossings} yours`}
            variant="lib"
            onClick={() => setLocation("/library")}
          />
        </Group>,
      );
    }
  }

  if (level === "station" && station) {
    const pastShows = station.shows.filter((s) => s.state !== "future");
    const djNames = [...new Set(pastShows.map((s) => s.djName).filter(Boolean) as string[])];
    const selectors = djNames.filter((d) => pastShows.some((s) => s.djName === d && s.isPickerShow));
    const others = djNames.filter((d) => !selectors.includes(d)).slice(0, 2);
    // Build artist → artistMbid map from all past spins
    const stationArtistNav = new Map<string, { artistMbid: string | null; recordingMbid: string | null }>();
    for (const sp of pastShows.flatMap((s) => s.spins)) {
      if (!stationArtistNav.has(sp.artist)) {
        stationArtistNav.set(sp.artist, { artistMbid: sp.artistMbid ?? null, recordingMbid: sp.mbid ?? null });
      }
    }
    const yourArtists = [
      ...new Set(pastShows.flatMap((s) => s.spins.filter((sp) => sp.isLibraryHit).map((sp) => sp.artist))),
    ].slice(0, 4);
    const totalCross = station.crossings;

    function stationArtistClick(name: string) {
      const nav = stationArtistNav.get(name);
      if (nav?.artistMbid) return () => setLocation(`/artist/${nav.artistMbid}`);
      if (nav?.recordingMbid) return () => setLocation(`/song/${nav.recordingMbid}`);
      return () => showToast("No page available yet");
    }

    if (selectors.length > 0) {
      parts.push(
        <Group key="selectors" label="Selectors">
          {selectors.map((d) => (
            <Chip key={d} label={d} variant="sel" onClick={() => onDjClick(d)} />
          ))}
        </Group>,
      );
      if (others.length > 0) {
        parts.push(<Sep key="sep1" />);
        parts.push(
          <Group key="djs" label="DJs">
            {others.map((d) => (
              <Chip key={d} label={d} onClick={() => onDjClick(d)} />
            ))}
          </Group>,
        );
      }
    } else if (djNames.length > 0) {
      parts.push(
        <Group key="djs" label="DJs">
          {djNames.slice(0, 3).map((d) => (
            <Chip key={d} label={d} onClick={() => onDjClick(d)} />
          ))}
        </Group>,
      );
    }

    if (yourArtists.length > 0) {
      parts.push(<Sep key="sep2" />);
      parts.push(
        <Group key="artists" label="Your artists">
          {yourArtists.map((a) => (
            <Chip key={a} label={a} variant="lib" onClick={stationArtistClick(a)} />
          ))}
        </Group>,
      );
    }

    if (totalCross > 0) {
      parts.push(<Sep key="sep3" />);
      parts.push(
        <Group key="library" label="Library">
          <Chip
            label={`◆ ${totalCross} heard here`}
            variant="lib"
            onClick={() => setLocation("/library")}
          />
        </Group>,
      );
    }
  }

  if (level === "dj" && djName) {
    const djShows = allStations
      .flatMap((ds) => ds.shows.map((sh) => ({ show: sh, station: ds })))
      .filter(({ show }) => show.djName === djName && show.state !== "future");

    const stationNames = [...new Set(djShows.map((x) => x.station.station.name))];
    // Build artist → artistMbid map from all DJ spins
    const djArtistNav = new Map<string, { artistMbid: string | null; recordingMbid: string | null }>();
    for (const sp of djShows.flatMap(({ show }) => show.spins)) {
      if (!djArtistNav.has(sp.artist)) {
        djArtistNav.set(sp.artist, { artistMbid: sp.artistMbid ?? null, recordingMbid: sp.mbid ?? null });
      }
    }
    const yourArtists = [
      ...new Set(djShows.flatMap(({ show }) => show.spins.filter((sp) => sp.isLibraryHit).map((sp) => sp.artist))),
    ].slice(0, 4);
    const newArtists = [
      ...new Set(djShows.flatMap(({ show }) => show.spins.filter((sp) => !sp.isLibraryHit).map((sp) => sp.artist))),
    ]
      .filter((a) => !yourArtists.includes(a))
      .slice(0, 2);
    const totalCross = djShows.reduce((sum, { show }) => sum + show.crossings, 0);

    function djArtistClick(name: string) {
      const nav = djArtistNav.get(name);
      if (nav?.artistMbid) return () => setLocation(`/artist/${nav.artistMbid}`);
      if (nav?.recordingMbid) return () => setLocation(`/song/${nav.recordingMbid}`);
      return () => showToast("No page available yet");
    }

    parts.push(
      <Group key="stations" label="Stations">
        {stationNames.map((n) => {
          const ds = allStations.find((s) => s.station.name === n);
          return (
            <Chip
              key={n}
              label={n}
              variant="live"
              onClick={() => ds && onStationClick(ds.station.slug)}
            />
          );
        })}
      </Group>,
    );

    if (yourArtists.length > 0) {
      parts.push(<Sep key="sep1" />);
      parts.push(
        <Group key="artists" label="Your artists">
          {yourArtists.map((a) => (
            <Chip key={a} label={a} variant="lib" onClick={djArtistClick(a)} />
          ))}
        </Group>,
      );
    }
    if (newArtists.length > 0) {
      parts.push(<Sep key="sep2" />);
      parts.push(
        <Group key="new" label="New to you">
          {newArtists.map((a) => (
            <Chip key={a} label={a} variant="new" onClick={djArtistClick(a)} />
          ))}
        </Group>,
      );
    }
    if (totalCross > 0) {
      parts.push(<Sep key="sep3" />);
      parts.push(
        <Group key="library" label="Library">
          <Chip
            label={`◆ ${totalCross} crossings`}
            variant="lib"
            onClick={() => setLocation("/library")}
          />
        </Group>,
      );
    }
  }

  if (parts.length === 0) return null;

  return (
    <div className="ctx-rail">
      <div className="ctx-rail-inner">{parts}</div>
    </div>
  );
}
