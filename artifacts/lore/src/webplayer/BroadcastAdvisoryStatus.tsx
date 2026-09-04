import { useEffect, useState } from "react";
import { deriveBroadcastAdvisory } from "../player/liveHandoff";
import type { WpNow } from "./hooks";

export function BroadcastAdvisoryStatus({ now }: { now: WpNow }) {
  const serverMs = Date.parse(now.serverTime ?? "");
  const [atMs, setAtMs] = useState(() =>
    Number.isFinite(serverMs) ? serverMs : Date.now(),
  );
  const expiresAt = now.broadcastAdvisory?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const expiryMs = Date.parse(expiresAt);
    const referenceMs = Number.isFinite(serverMs) ? serverMs : Date.now();
    const remaining = expiryMs - referenceMs;
    const id = window.setTimeout(
      () => setAtMs(expiryMs),
      Math.max(0, remaining) + 10,
    );
    return () => window.clearTimeout(id);
  }, [expiresAt, serverMs]);
  const advisory = deriveBroadcastAdvisory(
    now,
    Number.isFinite(serverMs) ? Math.max(atMs, serverMs) : atMs,
  );
  if (!advisory) return null;
  return (
    <p
      className="wp-broadcast-advisory wp-mono"
      role="status"
      aria-live="polite"
      data-testid="wp-broadcast-advisory"
    >
      <span className="wp-broadcast-advisory__dot" aria-hidden="true" />
      {advisory.label}
    </p>
  );
}