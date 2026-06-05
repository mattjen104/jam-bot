/**
 * Injectable logger for the song-enrichment library.
 *
 * Defaults to a no-op so the library is silent when embedded in a host that
 * doesn't care about its logs (e.g. the API server). jam-bot wires its own
 * logger via `setEnrichmentLogger` at boot to preserve its existing output.
 */
export interface EnrichmentLogger {
  debug: (msg: string, meta?: unknown) => void;
  info: (msg: string, meta?: unknown) => void;
  warn: (msg: string, meta?: unknown) => void;
  error: (msg: string, meta?: unknown) => void;
}

const noop: EnrichmentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let active: EnrichmentLogger = noop;

export function setEnrichmentLogger(next: EnrichmentLogger): void {
  active = next;
}

/** Stable proxy so modules can `import { logger }` once at module load. */
export const logger: EnrichmentLogger = {
  debug: (msg, meta) => active.debug(msg, meta),
  info: (msg, meta) => active.info(msg, meta),
  warn: (msg, meta) => active.warn(msg, meta),
  error: (msg, meta) => active.error(msg, meta),
};
