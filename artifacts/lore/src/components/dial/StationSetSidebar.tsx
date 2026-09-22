import {
  useGetStationCurrentSet,
  getGetStationCurrentSetQueryKey,
} from "@workspace/api-client-react";
import type { StationCurrentSetSpin } from "@workspace/api-client-react";
import { KeepButton } from "../KeepButton";
import { clockTime } from "../../lib/format";
import type { LibraryProvenance } from "../../lib/meHooks";

/**
 * Landscape Dial right-hand panel: the tuned/selected station's in-progress
 * set. "On air" card for the current track + "Earlier this set" rows, each
 * with its own Keep. Data comes from GET /stations/:slug/current-set, which
 * groups spins by the archive's (station, show, UTC day) run derivation, so
 * a live set here and a completed set in the archive are the same shape.
 *
 * Honesty rules (now-playing contract): artwork/links/metadata may be absent
 * — rows degrade to raw broadcast text, and an unresolved row is labelled
 * "Unresolved", never given a fabricated title.
 */

/** Match the front door's poll cadence so new spins land on the normal cycle. */
const CURRENT_SET_POLL_MS = 30_000;

/**
 * Which station the panel pins to. A selected station (context mode) wins
 * over the tuned station; with neither — or in portrait, where the in-body
 * set surfaces remain the path — the panel stays hidden.
 */
export function resolveSetSidebarSlug(args: {
  sidebarLayout: boolean;
  inContext: boolean;
  ctxSlug: string | null | undefined;
  tunedSlug: string | null;
}): string | null {
  if (!args.sidebarLayout) return null;
  return (args.inContext && args.ctxSlug) || args.tunedSlug || null;
}

function rowTitle(spin: StationCurrentSetSpin): string {
  return spin.title || "Unresolved";
}

function rowArtist(spin: StationCurrentSetSpin): string {
  return spin.artist || (spin.title ? "" : "Title not broadcast");
}

function SetRow({
  spin,
  timeZone,
  provenance,
}: {
  spin: StationCurrentSetSpin;
  timeZone: string | null;
  provenance: Partial<LibraryProvenance>;
}) {
  const artist = rowArtist(spin);
  return (
    <div className="setrow" data-testid={`setrow-${spin.spinId}`}>
      <span className="setrow__time">{clockTime(spin.playedAt, timeZone)}</span>
      <span className="setrow__body">
        <span className="setrow__title">{rowTitle(spin)}</span>
        {artist ? <span className="setrow__artist">{artist}</span> : null}
      </span>
      <KeepButton
        mbid={spin.mbid}
        spinId={spin.spinId}
        compact
        label={spin.mbid ? undefined : "Keep as ID"}
        provenance={provenance}
      />
    </div>
  );
}

export function StationSetSidebar({ stationSlug }: { stationSlug: string }) {
  const { data } = useGetStationCurrentSet(stationSlug, {
    query: {
      queryKey: getGetStationCurrentSetQueryKey(stationSlug),
      refetchInterval: CURRENT_SET_POLL_MS,
      staleTime: 15_000,
      retry: false,
    },
  });

  if (!data || data.spins.length === 0) return null;

  // Newest first; the first spin is on air, the rest are "Earlier this set".
  // Rows key on spinId so a poll that prepends a new spin never re-sorts or
  // re-mounts rows under the listener's cursor.
  const [onAir, ...earlier] = data.spins;
  const timeZone = data.ianaTimezone;
  const provenance: Partial<LibraryProvenance> = {
    kind: "keep",
    source: "set_sidebar",
    stationSlug: data.station.slug,
    stationName: data.station.name,
  };
  const onAirTitle = rowTitle(onAir);
  const onAirArtist = onAir.artist || "";
  const album = onAir.albumTitle;

  return (
    <aside className="set-sidebar" aria-label={`On air on ${data.station.name}`}>
      <section className="set-sidebar__onair">
        <div className="set-sidebar__eyebrow">
          <span className="set-sidebar__live-dot" aria-hidden="true" />
          ON AIR · {data.station.name}
          {data.showName ? ` · ${data.showName}` : ""}
        </div>
        {data.djName ? (
          <div className="set-sidebar__selector">Selected by {data.djName}</div>
        ) : null}
        <div className="set-sidebar__track">
          <span className="set-sidebar__title">{onAirTitle}</span>
          {onAirArtist || album ? (
            <span className="set-sidebar__artist">
              {onAirArtist}
              {onAirArtist && album ? " · " : ""}
              {album ?? ""}
            </span>
          ) : null}
        </div>
        <KeepButton
          mbid={onAir.mbid}
          spinId={onAir.spinId}
          label={onAir.mbid ? "Keep this song" : "Keep as ID"}
          className="set-sidebar__keep-primary"
          provenance={provenance}
        />
        <div className="set-sidebar__explainer">
          Keeping sends {album ?? (onAir.mbid ? "this song" : "this spin")} to your
          Library Inbox with this spin attached.
        </div>
      </section>

      {earlier.length > 0 ? (
        <section className="set-sidebar__earlier">
          <div className="set-sidebar__earlier-label">Earlier this set</div>
          <div className="set-sidebar__rows">
            {earlier.map((spin) => (
              <SetRow
                key={spin.spinId}
                spin={spin}
                timeZone={timeZone}
                provenance={provenance}
              />
            ))}
          </div>
        </section>
      ) : null}
    </aside>
  );
}
