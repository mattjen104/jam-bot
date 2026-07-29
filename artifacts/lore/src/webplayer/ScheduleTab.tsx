import { useWpSchedule, type WpScheduleSlot } from "./hooks";

const oneLine: React.CSSProperties = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** "22:00" → "10 PM"-style short local label (keeps 24h minutes when non-zero). */
function shortTime(hhmm: string): string {
  const [hs, ms] = hhmm.split(":");
  const h = Number(hs);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return ms === "00" ? `${h12} ${suffix}` : `${h12}:${ms} ${suffix}`;
}

function SlotRow({
  slot,
  onOpenRun,
}: {
  slot: WpScheduleSlot;
  onOpenRun: (slug: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderBottom: "0.5px solid var(--wp-border)",
      }}
      data-testid={`wp-schedule-${slot.stationSlug}-${slot.startTime}`}
    >
      <span
        className="wp-mono"
        style={{
          fontSize: 10,
          color: slot.isLive ? "var(--wp-text-success)" : "var(--wp-text-muted)",
          width: 44,
          textAlign: "left",
          flexShrink: 0,
        }}
      >
        {slot.isLive ? "NOW" : shortTime(slot.startTime)}
      </span>
      <button
        type="button"
        onClick={() => onOpenRun(slot.stationSlug)}
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
        aria-label={`Open ${slot.showName} on ${slot.stationName}`}
      >
        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, ...oneLine }}>
          {slot.showName}
          {slot.djName && (
            <span style={{ fontSize: 11, color: "var(--wp-text-muted)", fontWeight: 400 }}>
              {" "}
              · {slot.djName}
            </span>
          )}
        </p>
        <p style={{ margin: "1px 0 0", fontSize: 11, color: "var(--wp-text-secondary)", ...oneLine }}>
          {slot.stationName}
          <span className="wp-mono" style={{ fontSize: 10, color: "var(--wp-text-muted)" }}>
            {" "}
            · {shortTime(slot.startTime)}–{shortTime(slot.endTime)} local
          </span>
        </p>
      </button>
      {slot.isLive && (
        <span
          className="wp-pill wp-mono"
          style={{
            background: "var(--wp-bg-success)",
            color: "var(--wp-text-success)",
            fontSize: 10,
            flexShrink: 0,
          }}
        >
          LIVE
        </span>
      )}
    </div>
  );
}

/** SCHEDULE tab: what's on the air right now, then the rest of today. */
export function ScheduleTab({ onOpenRun }: { onOpenRun: (slug: string) => void }) {
  const { data, isLoading } = useWpSchedule();
  const liveNow = data?.liveNow ?? [];
  const upcoming = data?.upcomingToday ?? [];

  return (
    <div data-testid="wp-schedule-tab">
      {isLoading && (
        <div className="wp-card">
          <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
            Reading the programme guides…
          </p>
        </div>
      )}
      {!isLoading && (
        <>
          <p className="wp-mono" style={{ margin: "0 0 6px", fontSize: 11, color: "var(--wp-text-muted)" }}>
            ON NOW · {liveNow.length}
          </p>
          <div className="wp-card" style={{ overflow: "hidden", marginBottom: 18 }}>
            {liveNow.length === 0 && (
              <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
                No scheduled shows airing right now.
              </p>
            )}
            {liveNow.map((s) => (
              <SlotRow key={`${s.stationSlug}-${s.startTime}-${s.showName}`} slot={s} onOpenRun={onOpenRun} />
            ))}
          </div>
          <p className="wp-mono" style={{ margin: "0 0 6px", fontSize: 11, color: "var(--wp-text-muted)" }}>
            LATER TODAY · {upcoming.length}
          </p>
          <div className="wp-card" style={{ overflow: "hidden" }}>
            {upcoming.length === 0 && (
              <p style={{ padding: "14px 16px", margin: 0, fontSize: 13, color: "var(--wp-text-muted)" }}>
                Nothing more on today's grids.
              </p>
            )}
            {upcoming.map((s) => (
              <SlotRow key={`${s.stationSlug}-${s.startTime}-${s.showName}`} slot={s} onOpenRun={onOpenRun} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
