/**
 * Hand-curated seed of timestamped track insights.
 *
 * This is the entire data source for the live-insight feature (Task #39): a
 * small set of well-known tracks with genuinely well-documented musical /
 * production moments, each keyed to a canonical recording id and a position in
 * the track. There is deliberately NO automated ingestion, scraping, or LLM
 * generation here — every note is curated by hand and must be accurate. With
 * this list empty, the whole feature is a no-op.
 *
 * Keying:
 *   - `isrc` is the practical canonical id: ACRCloud returns it for almost
 *     every match and it is effectively 1:1 with a MusicBrainz recording (the
 *     same identity the liner-notes/context caches converge on).
 *   - `recordingId` (MusicBrainz recording id) is the deeper canonical id and
 *     is supported too; provide either or both.
 * At runtime an entry only ever fires when its id matches the identified
 * record, so an unknown/stale id simply means the feature stays quiet for that
 * track (safe by construction) — it never surfaces a note for the wrong song.
 *
 * `positionMs` is the offset into the recording where the moment happens.
 * Values below are approximate timings on the canonical studio recordings;
 * refine or extend as the curated set grows. ISRCs should be verified against
 * the exact pressing you expect ACRCloud to return before relying on a note
 * firing in production — a mismatch is harmless (no note) but means the entry
 * is dormant.
 */

export interface SeedInsight {
  /** Offset into the recording (ms) where this moment happens. */
  positionMs: number;
  /** Short, accurate, curated note shown when playback reaches positionMs. */
  text: string;
}

export interface SeedTrackInsights {
  /** ISRC of the canonical recording (case-insensitive). Optional. */
  isrc?: string;
  /** MusicBrainz recording id of the canonical recording. Optional. */
  recordingId?: string;
  /** Human label for maintenance only — never used for matching. */
  label: string;
  insights: SeedInsight[];
}

/**
 * The curated seed. Timings are for the original studio recordings. ISRCs are
 * best-effort for well-known pressings and should be verified per deployment;
 * an entry stays dormant (no note) until its id actually matches.
 */
export const seedTrackInsights: SeedTrackInsights[] = [
  {
    label: "Queen — Bohemian Rhapsody (1975)",
    isrc: "GBUM71029604",
    insights: [
      {
        positionMs: 0,
        text: "It opens a cappella — those layered harmonies are all Queen, multi-tracked over and over with no synthesizers.",
      },
      {
        positionMs: 48_000,
        text: "Here the piano ballad settles in — Freddie Mercury wrote the whole suite around this piano line.",
      },
      {
        positionMs: 183_000,
        text: "The operatic section starts here — the band overdubbed their vocals for days to stack up the mock-choir.",
      },
      {
        positionMs: 247_000,
        text: "And the hard-rock turn — Brian May's guitar comes crashing in for 'So you think you can stone me'.",
      },
    ],
  },
  {
    label: "a-ha — Take On Me (1985)",
    isrc: "NOGGG8500101",
    insights: [
      {
        positionMs: 18_000,
        text: "That instantly recognizable synth riff — it's a Roland Juno-60 hook the band reworked across two earlier versions before it stuck.",
      },
      {
        positionMs: 49_000,
        text: "Listen for Morten Harket's falsetto leap into the chorus — he tops out near a high E, about two and a half octaves up.",
      },
    ],
  },
  {
    label: "The Beatles — A Day in the Life (1967)",
    isrc: "GBAYE0601498",
    insights: [
      {
        positionMs: 145_000,
        text: "This rising swell is the famous orchestral crescendo — the players were told to slide from the lowest to the highest note over 24 bars.",
      },
      {
        positionMs: 297_000,
        text: "And the final chord — three pianos struck at once, held and faded for around forty seconds.",
      },
    ],
  },
];
