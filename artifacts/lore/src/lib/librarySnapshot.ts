const SNAPSHOT_PREFIX = "lore:library:first-page:v1:";
const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

interface StoredLibrarySnapshot {
  savedAt: number;
  page: unknown;
}

function storageKey(parts: readonly (string | number)[]): string {
  return `${SNAPSHOT_PREFIX}${JSON.stringify(parts)}`;
}

function isLibraryPage(value: unknown): value is {
  items: unknown[];
  nextCursor: string | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    (typeof page.nextCursor === "string" || page.nextCursor === null)
  );
}

/** Read a recent first page for an immediate stale-while-refresh render. */
export function readLibrarySnapshot<T>(
  keyParts: readonly (string | number)[],
): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(keyParts));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StoredLibrarySnapshot;
    if (
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > SNAPSHOT_MAX_AGE_MS ||
      !isLibraryPage(parsed.page)
    ) {
      window.localStorage.removeItem(storageKey(keyParts));
      return undefined;
    }
    return parsed.page as T;
  } catch {
    return undefined;
  }
}

/** Persist only the first page; later pages keep loading normally. */
export function writeLibrarySnapshot(
  keyParts: readonly (string | number)[],
  page: unknown,
): void {
  if (typeof window === "undefined" || !isLibraryPage(page)) return;
  try {
    window.localStorage.setItem(
      storageKey(keyParts),
      JSON.stringify({ savedAt: Date.now(), page }),
    );
  } catch {
    // A full/disabled localStorage must never break the live Library request.
  }
}