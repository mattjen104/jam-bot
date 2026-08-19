/**
 * CompactDialRemote — the name-only station row for the dial band's
 * "compact" density (the remote-control view).
 *
 * One key = muted ordinal (the station's 1-based position across the whole
 * active list, not just the visible page) + station name. Compact keys are
 * laid out two across by the parent grid. Tapping the key tunes in. There is
 * deliberately no play triangle, no now-playing sentence, no crossing dot,
 * no scan checkbox, and no expansion — the full row grammar stays on the
 * "normal" density.
 */

import type { DialLaneRow } from "./dial/DialFeedLane";

export interface CompactDialRemoteProps {
  row: DialLaneRow;
  /** 1-based position of this station in the full active list. */
  ordinal: number;
  isSampling: boolean;
  isActive: boolean;
  onTuneIn: (row: DialLaneRow) => void;
  /** True when the station is still playing whatever the listener's last
   *  scan sampled — dims the key and notes it in the tooltip. */
  unchanged?: boolean;
}

export function CompactDialRemote({
  row,
  ordinal,
  isSampling,
  isActive,
  onTuneIn,
  unchanged = false,
}: CompactDialRemoteProps) {
  const name = row.ds.station.name;
  return (
    <button
      type="button"
      className={[
        "compact-dial__remote-row",
        isSampling ? "compact-dial__remote-row--sampling" : "",
        isActive ? "compact-dial__remote-row--active" : "",
        unchanged ? "compact-dial__remote-row--unchanged" : "",
      ].filter(Boolean).join(" ")}
      aria-label={`${ordinal}. ${name} — tune in`}
      title={unchanged ? `${name} — same song as your last scan` : name}
      onClick={() => onTuneIn(row)}
    >
      <span className="compact-dial__remote-ordinal" aria-hidden="true">{ordinal}</span>
      <span className="compact-dial__remote-name">{name}</span>
    </button>
  );
}
