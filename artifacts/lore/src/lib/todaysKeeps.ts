import type { LibraryItem } from "./meHooks";

export const TODAY_KEEPS_LIMIT = 6;

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function wasAddedToday(item: LibraryItem, now: Date): boolean {
  const addedAt = new Date(item.addedAt);
  return !Number.isNaN(addedAt.getTime())
    && addedAt.getFullYear() === now.getFullYear()
    && addedAt.getMonth() === now.getMonth()
    && addedAt.getDate() === now.getDate();
}

export function getTodaysActiveKeeps(
  items: LibraryItem[],
  now: Date,
  limit = TODAY_KEEPS_LIMIT,
): LibraryItem[] {
  return items
    .filter((item) => !item.removed && item.recording && wasAddedToday(item, now))
    .slice(0, limit);
}

export function hasCrossedTodaysBoundary(items: LibraryItem[], now: Date): boolean {
  const todayStartedAt = startOfLocalDay(now).getTime();
  return items.some((item) => {
    const addedAt = new Date(item.addedAt).getTime();
    return !Number.isNaN(addedAt) && addedAt < todayStartedAt;
  });
}