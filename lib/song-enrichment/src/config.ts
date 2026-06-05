/**
 * Lazy, all-optional configuration for the song-enrichment library.
 *
 * This replaces jam-bot's `config.ts` for the enrichment modules. The original
 * config validated the WHOLE bot environment at import and called
 * `process.exit` on missing required vars — unusable from another artifact.
 *
 * Here we read `process.env` lazily through getters, replicating the EXACT
 * defaults and boolean parsing jam-bot used, so behavior is byte-identical when
 * the same env vars are present, and everything degrades gracefully (to its
 * default / undefined) when they are absent.
 */

/** Mirror of jam-bot's `parseBoolEnv`. */
export function parseBoolEnv(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (["false", "0", "no", "off", ""].includes(s)) return false;
  return true;
}

function boolEnv(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  return v === undefined ? defaultValue : parseBoolEnv(v);
}

function intEnv(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return defaultValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : defaultValue;
}

function strEnv(key: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === "" ? undefined : v;
}

/**
 * Config surface used by the enrichment modules. Property access reads
 * `process.env` at call time so consumers (and the jam-bot test suite, which
 * sets `process.env` before invoking functions) observe the current values.
 */
export const config = {
  get MUSICBRAINZ_CONTACT(): string | undefined {
    return strEnv("MUSICBRAINZ_CONTACT");
  },
  get DISCOGS_TOKEN(): string | undefined {
    return strEnv("DISCOGS_TOKEN");
  },
  get LASTFM_API_KEY(): string | undefined {
    return strEnv("LASTFM_API_KEY");
  },
  get GENIUS_ACCESS_TOKEN(): string | undefined {
    return strEnv("GENIUS_ACCESS_TOKEN");
  },
  get ODESLI_API_KEY(): string | undefined {
    return strEnv("ODESLI_API_KEY");
  },

  get TRACK_KNOWLEDGE_ENABLED(): boolean {
    return boolEnv("TRACK_KNOWLEDGE_ENABLED", true);
  },
  get TRACK_KNOWLEDGE_CACHE_TTL_DAYS(): number {
    return intEnv("TRACK_KNOWLEDGE_CACHE_TTL_DAYS", 30);
  },
  get TRACK_KNOWLEDGE_LLM_SUMMARY(): boolean {
    return boolEnv("TRACK_KNOWLEDGE_LLM_SUMMARY", false);
  },

  get TRACK_CONTEXT_ENABLED(): boolean {
    return boolEnv("TRACK_CONTEXT_ENABLED", true);
  },
  get TRACK_CONTEXT_WIKIPEDIA(): boolean {
    return boolEnv("TRACK_CONTEXT_WIKIPEDIA", true);
  },
  get TRACK_CONTEXT_CACHE_TTL_DAYS(): number {
    return intEnv("TRACK_CONTEXT_CACHE_TTL_DAYS", 30);
  },
  get TRACK_CONTEXT_LLM_SUMMARY(): boolean {
    return boolEnv("TRACK_CONTEXT_LLM_SUMMARY", false);
  },

  get TRACK_LINKS_ENABLED(): boolean {
    return boolEnv("TRACK_LINKS_ENABLED", true);
  },

  get TRACK_INSIGHTS_ENABLED(): boolean {
    return boolEnv("TRACK_INSIGHTS_ENABLED", true);
  },
  get TRACK_INSIGHTS_POLL_MS(): number {
    return intEnv("TRACK_INSIGHTS_POLL_MS", 1000);
  },
};
