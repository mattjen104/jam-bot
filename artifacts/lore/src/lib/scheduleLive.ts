/** "HH:MM" → minutes since midnight; NaN-safe (returns null on garbage). */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(mins) ? mins : null;
}

/**
 * Is a slot live at `nowMins` (minutes since local midnight)? A slot with a
 * missing/unparseable end time is treated as a 1-hour block. A slot whose end
 * is before its start crosses midnight and counts as live until midnight —
 * the schedule grid is per-day, so the after-midnight tail belongs to the
 * previous day's row and is handled by isOvernightCarryoverLive.
 */
export function isSlotLive(
  startTime: string,
  endTime: string | null,
  nowMins: number,
): boolean {
  const start = toMinutes(startTime);
  if (start == null) return false;
  let end = endTime ? toMinutes(endTime) : null;
  if (end == null) end = start + 60;
  if (end <= start) end = 24 * 60; // crosses midnight → live until midnight
  return nowMins >= start && nowMins < end;
}

/**
 * A slot from the *previous* day that crosses midnight (end <= start, or a
 * null end whose implied 60-minute run spills past 24:00) is still live in
 * the early minutes of today. Complements isSlotLive, which only covers the
 * pre-midnight portion.
 */
export function isOvernightCarryoverLive(
  startTime: string,
  endTime: string | null,
  nowMins: number,
): boolean {
  const start = toMinutes(startTime);
  if (start == null) return false;
  const end = endTime ? toMinutes(endTime) : null;
  if (end != null) {
    if (end > start) return false; // doesn't cross midnight
    return nowMins < end; // live from 00:00 until the stated end
  }
  const implied = start + 60;
  if (implied <= 24 * 60) return false;
  return nowMins < implied - 24 * 60;
}
