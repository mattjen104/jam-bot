/**
 * MicroDialRemote — the dial band's "micro" density: the current page of 15
 * active stations as numbered buttons, three across like a telephone keypad.
 *
 * Each button shows only the station's ordinal (its 1-based position in the
 * full active list); the station name lives on the accessible label and the
 * hover title. Tapping a button tunes in immediately. There is no expansion,
 * no track detail, and no scan checkbox at this density. The triad wrappers
 * preserve logical grouping while CSS lets each key fill its grid cell.
 */

import type { DialLaneRow } from "./dial/DialFeedLane";

export interface MicroDialRemoteProps {
  /** The current page of active stations (up to 15 per page). */
  rows: DialLaneRow[];
  /** 1-based ordinal of rows[0] in the full active list (default 1). */
  firstOrdinal?: number;
  /** Index into rows of the station being sampled, or null. */
  samplingRowIdx?: number | null;
  activeSlug: string | null;
  onTuneIn: (row: DialLaneRow) => void;
}

export function MicroDialRemote({
  rows,
  firstOrdinal = 1,
  samplingRowIdx = null,
  activeSlug,
  onTuneIn,
}: MicroDialRemoteProps) {
  const triads: DialLaneRow[][] = [];
  for (let i = 0; i < rows.length; i += 3) {
    triads.push(rows.slice(i, i + 3));
  }
  return (
    <div className="compact-dial__micro-grid" role="group" aria-label="Station keypad">
      {triads.map((triad, ti) => (
        <div className="compact-dial__micro-triad" key={ti}>
          {triad.map((row, i) => {
            const idx = ti * 3 + i;
            const ordinal = firstOrdinal + idx;
            const slug = row.ds.station.slug;
            const name = row.ds.station.name;
            return (
              <button
                key={slug}
                type="button"
                className={[
                  "compact-dial__micro-btn",
                  samplingRowIdx === idx ? "compact-dial__micro-btn--sampling" : "",
                  slug === activeSlug ? "compact-dial__micro-btn--active" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${ordinal}. ${name} — tune in`}
                title={name}
                onClick={() => onTuneIn(row)}
              >
                {ordinal}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
