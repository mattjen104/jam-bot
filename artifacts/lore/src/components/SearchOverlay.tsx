/**
 * SearchOverlay — full-screen search mode.
 *
 * Opens when the user taps the search icon in the Dial topbar.
 * Runs a client-side fuzzy match against:
 *   - All stations (loaded via useListStations)
 *   - All selectors/pickers (loaded via useListPickers)
 *   - Shows and tracks from today's dial data (passed as props)
 *
 * Results are grouped by entity type (Stations · Selectors · Shows · Tracks)
 * and filterable via chips. Navigation closes the overlay automatically.
 */
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { useListPickers, useListStations } from "@workspace/api-client-react";
import type { DialStation, DialShow } from "../hooks/useDialData";
import { X, Search } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Filter = "all" | "stations" | "selectors" | "shows" | "tracks";

interface SearchResult {
  kind: "station" | "selector" | "show" | "track";
  label: string;
  sub: string;
  badge?: string;
  onTap?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fuzzy(text: string | null | undefined, q: string): boolean {
  if (!text || !q) return false;
  return text.toLowerCase().includes(q.toLowerCase());
}

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  station: "Stations",
  selector: "Selectors",
  show: "Shows",
  track: "Tracks",
};

const KIND_ICON: Record<SearchResult["kind"], string> = {
  station: "📻",
  selector: "◆",
  show: "🎚",
  track: "♪",
};

const MAX_PER_KIND = 6;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SearchOverlayProps {
  /** Today's dial stations — used for show/track search. */
  dialStations: DialStation[];
  onClose: () => void;
  /** Navigate within the Dial's state machine. */
  onStationDrill: (slug: string) => void;
  onShowDrill: (show: DialShow, station: DialStation) => void;
}

export function SearchOverlay({
  dialStations,
  onClose,
  onStationDrill,
  onShowDrill,
}: SearchOverlayProps) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  // Load full station + picker lists for search
  const { data: stationsData } = useListStations();
  const { data: pickersData } = useListPickers();

  useEffect(() => {
    // Autofocus the input when the overlay opens
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  // Close on back gesture / Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goAndClose = useCallback((href: string) => {
    setLocation(href);
    onClose();
  }, [setLocation, onClose]);

  // ---------------------------------------------------------------------------
  // Build search results
  // ---------------------------------------------------------------------------
  const results = useMemo((): SearchResult[] => {
    const q = query.trim();
    if (!q) return [];
    const out: SearchResult[] = [];

    // ── Stations ──────────────────────────────────────────────────────────────
    if (filter === "all" || filter === "stations") {
      let n = 0;
      for (const s of stationsData?.stations ?? []) {
        if (n >= MAX_PER_KIND) break;
        if (fuzzy(s.name, q) || fuzzy(s.org, q) || fuzzy(s.city, q)) {
          out.push({
            kind: "station",
            label: s.name,
            sub: [s.org, s.city, s.country].filter(Boolean).join(" · "),
            badge: s.tier === "flagship" ? "curated" : undefined,
            onTap: () => { onStationDrill(s.slug); onClose(); },
          });
          n++;
        }
      }
    }

    // ── Selectors ─────────────────────────────────────────────────────────────
    if (filter === "all" || filter === "selectors") {
      let n = 0;
      for (const p of pickersData?.pickers ?? []) {
        if (n >= MAX_PER_KIND) break;
        if (fuzzy(p.name, q) || fuzzy(p.handle, q) || fuzzy(p.description, q)) {
          out.push({
            kind: "selector",
            label: p.name,
            sub: p.description ?? `@${p.handle}`,
            badge: "◆ Selector",
            onTap: () => goAndClose(`/archive/selectors/${p.handle}`),
          });
          n++;
        }
      }
    }

    // ── Shows (from today's dial data) ────────────────────────────────────────
    if (filter === "all" || filter === "shows") {
      const seen = new Set<string>();
      let n = 0;
      for (const ds of dialStations) {
        for (const sh of ds.shows) {
          if (n >= MAX_PER_KIND) break;
          const key = sh.runId != null ? String(sh.runId) : `${sh.showName}|${sh.startedAt}`;
          if (seen.has(key)) continue;
          if (fuzzy(sh.showName, q) || fuzzy(sh.djName, q)) {
            seen.add(key);
            out.push({
              kind: "show",
              label: sh.showName,
              sub: [sh.djName, ds.station.name].filter(Boolean).join(" · "),
              onTap: () => { onShowDrill(sh, ds); onClose(); },
            });
            n++;
          }
        }
      }
    }

    // ── Tracks (from today's dial data) ───────────────────────────────────────
    if (filter === "all" || filter === "tracks") {
      const seen = new Set<string>();
      let n = 0;
      outer: for (const ds of dialStations) {
        for (const sh of ds.shows) {
          for (const sp of sh.spins) {
            if (n >= MAX_PER_KIND) break outer;
            const key = sp.mbid ?? `${sp.title}|${sp.artist}`;
            if (seen.has(key)) continue;
            if (fuzzy(sp.title, q) || fuzzy(sp.artist, q)) {
              seen.add(key);
              const trackMbid = sp.mbid;
              out.push({
                kind: "track",
                label: sp.title,
                sub: sp.artist,
                badge: sp.isLibraryHit ? "◆ yours" : undefined,
                onTap: trackMbid
                  ? () => goAndClose(`/song/${trackMbid}`)
                  : undefined,
              });
              n++;
            }
          }
        }
      }
    }

    return out;
  }, [query, filter, stationsData, pickersData, dialStations, onStationDrill, onShowDrill, onClose, goAndClose]);

  // Group results by kind in display order
  const groups = useMemo(() => {
    const kindOrder: SearchResult["kind"][] = ["station", "selector", "show", "track"];
    return kindOrder
      .map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) }))
      .filter(({ items }) => items.length > 0);
  }, [results]);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "stations", label: "Stations" },
    { key: "selectors", label: "Selectors" },
    { key: "shows", label: "Shows" },
    { key: "tracks", label: "Tracks" },
  ];

  return (
    <div className="srch-overlay" role="dialog" aria-modal="true" aria-label="Search Lore">
      {/* ── Input header ────────────────────────────────────────────────── */}
      <div className="srch-header">
        <Search className="srch-icon" size={14} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="srch-input"
          placeholder="Stations, selectors, shows, tracks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search"
        />
        {query && (
          <button
            type="button"
            className="srch-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="srch-close"
          onClick={onClose}
          aria-label="Close search"
        >
          Cancel
        </button>
      </div>

      {/* ── Filter chips ────────────────────────────────────────────────── */}
      <div className="srch-filters" role="group" aria-label="Filter results">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`srch-fchip${filter === key ? " srch-fchip--active" : ""}`}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      <div className="srch-results">
        {!query.trim() && (
          <div className="srch-empty">
            Search stations, selectors, shows, and tracks playing today.
          </div>
        )}

        {query.trim() && results.length === 0 && (
          <div className="srch-empty">No results for <em>"{query}"</em></div>
        )}

        {groups.map(({ kind, items }) => (
          <div key={kind} className="srch-group">
            <div className="srch-grp-lbl">{KIND_LABEL[kind]}</div>
            {items.map((r, i) => (
              <button
                key={i}
                type="button"
                className={`srch-row${!r.onTap ? " srch-row--muted" : ""}`}
                onClick={r.onTap}
                disabled={!r.onTap}
              >
                <span className="srch-row__icon" aria-hidden="true">
                  {KIND_ICON[kind]}
                </span>
                <div className="srch-row__body">
                  <span className="srch-row__label">{r.label}</span>
                  {r.sub && <span className="srch-row__sub">{r.sub}</span>}
                </div>
                {r.badge && (
                  <span className={`srch-row__badge${r.badge.startsWith("◆") ? " srch-row__badge--sel" : ""}`}>
                    {r.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
