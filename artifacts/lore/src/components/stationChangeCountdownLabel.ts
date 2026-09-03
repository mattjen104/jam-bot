import type { DialSpin } from "../hooks/useDialData";
import { deriveNextChange, formatRemaining } from "../player/liveHandoff";

export function stationChangeCountdownLabel(
  track: DialSpin | null | undefined,
  now = Date.now(),
): string | null {
  const timing = deriveNextChange(track, now);
  if (timing.remainingMs == null) return null;
  if (timing.state === "trusted") return formatRemaining(timing.remainingMs);
  if (timing.state === "estimated" || timing.state === "changing-soon") {
    return `~${formatRemaining(timing.remainingMs)}`;
  }
  return null;
}