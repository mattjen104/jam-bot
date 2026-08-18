/**
 * CompactDialRemote — the name-only station row for the dial band's
 * "compact" density (the remote-control view).
 *
 * One row = muted ordinal (the station's 1-based position across the whole
 * active list, not just the visible page) + station name. Tapping the row
 * tunes in. There is deliberately no play triangle, no now-playing sentence,
 * no crossing dot, no scan checkbox, and no expansion — the full row grammar
 * stays on the "normal" density.
 */

import type { DialLaneRow } from "./dial/DialFeedLane";

export interface CompactDialRemoteProps {
  row: DialLaneRow;
  /** 1-based position of this station in the full active list. */
  ordinal: number;
  isSampling: boolean;
  isActive: boolean;
  onTuneIn: (row: DialLaneRow) => void;
}

export function CompactDialRemote({
  row,
  ordinal,
  isSampling,
  isActive,
  onTuneIn,
}: CompactDialRemoteProps) {
  const name = row.ds.station.name;
  return (
    <button
      type="button"
      className={[
        "compact-dial__remote-row",
        isSampling ? "compact-dial__remote-row--sampling" : "",
        isActive ? "compact-dial__remote-row--active" : "",
      ].filter(Boolean).join(" ")}
      aria-label={`${ordinal}. ${name} — tune in`}
      onClick={() => onTuneIn(row)}
    >
      <span className="compact-dial__remote-ordinal" aria-hidden="true">{ordinal}</span>
      <span className="compact-dial__remote-name">{name}</span>
    </button>
  );
}
