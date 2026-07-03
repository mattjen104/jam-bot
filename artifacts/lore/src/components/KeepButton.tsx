import { useEffect, useState } from "react";
import { Heart } from "lucide-react";

const KEPT_KEY = "lore-kept-mbids";

function getKeptSet(): Set<string> {
  try {
    const raw = localStorage.getItem(KEPT_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function persistKept(mbids: Set<string>) {
  localStorage.setItem(KEPT_KEY, JSON.stringify([...mbids]));
}

export function useIsKept(mbid: string) {
  const [kept, setKept] = useState(() => getKeptSet().has(mbid));
  useEffect(() => {
    setKept(getKeptSet().has(mbid));
  }, [mbid]);
  return [kept, setKept] as const;
}

/**
 * Lime "Keep" button — local-first, no server round-trips.
 * Toggles to a muted "Kept ✓" state. Uses the --accent (lime) token for
 * the un-kept state per the Fable design spec.
 */
export function KeepButton({ mbid }: { mbid: string }) {
  const [kept, setKept] = useIsKept(mbid);

  const toggle = () => {
    const all = getKeptSet();
    if (kept) {
      all.delete(mbid);
    } else {
      all.add(mbid);
    }
    persistKept(all);
    setKept(!kept);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={kept ? "Kept" : "Keep this track"}
      aria-pressed={kept}
      data-testid="keep-button"
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors ${
        kept
          ? "border-border bg-muted/60 text-muted-foreground"
          : "border-accent/50 bg-accent text-accent-foreground"
      }`}
    >
      <Heart className={`h-3 w-3 ${kept ? "" : "fill-current"}`} />
      {kept ? "Kept ✓" : "Keep"}
    </button>
  );
}
