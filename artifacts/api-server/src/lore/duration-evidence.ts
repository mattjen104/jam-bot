/**
 * Small, process-local duration evidence store used by live resolution.
 *
 * A source duration (or a duration attached to a strong identifier) is safe
 * immediately. Text-only evidence is deliberately stricter: one observation
 * is not enough to distinguish an edit, remaster, or live version. A text
 * estimate is released only after repeated observations form a tight cluster.
 * The store is bounded because it is an acceleration layer, never the source
 * of truth.
 */

export type DurationEvidenceKind =
  | "source"
  | "recording_id"
  | "isrc"
  | "text";

export interface DurationEvidence {
  durationMs: number;
  kind: DurationEvidenceKind;
  samples: number;
}

interface Profile {
  strong?: DurationEvidence;
  textSamples: number[];
  touchedAt: number;
}

const MAX_PROFILES = 2_048;
const MAX_TEXT_SAMPLES = 8;
const MIN_TEXT_SAMPLES = 2;
const ABSOLUTE_CLUSTER_VARIANCE_MS = 4_000;
const RELATIVE_CLUSTER_VARIANCE = 0.025;

function validDuration(durationMs: number | null | undefined): durationMs is number {
  return (
    typeof durationMs === "number" &&
    Number.isFinite(durationMs) &&
    durationMs >= 10_000 &&
    durationMs <= 30 * 60_000
  );
}

function textKey(artist: string, title: string): string {
  return `${normalize(artist)}\u001f${normalize(title)}`;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function clusterDuration(samples: number[]): number | null {
  if (samples.length < MIN_TEXT_SAMPLES) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0]!;
  const max = sorted[sorted.length - 1]!;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const allowed = Math.max(
    ABSOLUTE_CLUSTER_VARIANCE_MS,
    median * RELATIVE_CLUSTER_VARIANCE,
  );
  if (max - min > allowed) return null;
  return Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length);
}

export class DurationEvidenceCache {
  private readonly profiles = new Map<string, Profile>();

  observeText(
    artist: string,
    title: string,
    durationMs: number | null | undefined,
    kind: Extract<DurationEvidenceKind, "source" | "text"> = "text",
  ): void {
    if (!validDuration(durationMs)) return;
    this.touch(textKey(artist, title), (profile) => {
      profile.textSamples.push(durationMs);
      if (profile.textSamples.length > MAX_TEXT_SAMPLES) profile.textSamples.shift();
      if (kind === "source") {
        profile.strong = { durationMs, kind, samples: 1 };
      }
    });
  }

  observeStrong(
    key: string,
    durationMs: number | null | undefined,
    kind: Extract<DurationEvidenceKind, "recording_id" | "isrc">,
  ): void {
    if (!validDuration(durationMs) || !key.trim()) return;
    this.touch(`strong:${kind}:${key.trim().toUpperCase()}`, (profile) => {
      profile.strong = { durationMs, kind, samples: 1 };
    });
  }

  estimate(
    artist: string,
    title: string,
    strongKeys: Array<{ key: string; kind: Extract<DurationEvidenceKind, "recording_id" | "isrc"> }> = [],
  ): DurationEvidence | null {
    for (const strongKey of strongKeys) {
      const profile = this.profiles.get(
        `strong:${strongKey.kind}:${strongKey.key.trim().toUpperCase()}`,
      );
      if (profile?.strong) {
        profile.touchedAt = Date.now();
        return profile.strong;
      }
    }
    const key = textKey(artist, title);
    const profile = this.profiles.get(key);
    if (!profile) return null;
    profile.touchedAt = Date.now();
    const durationMs = clusterDuration(profile.textSamples);
    return durationMs == null
      ? null
      : { durationMs, kind: "text", samples: profile.textSamples.length };
  }

  clear(): void {
    this.profiles.clear();
  }

  private touch(key: string, update: (profile: Profile) => void): void {
    let profile = this.profiles.get(key);
    if (!profile) {
      if (this.profiles.size >= MAX_PROFILES) {
        const oldest = [...this.profiles.entries()].reduce((a, b) =>
          a[1].touchedAt <= b[1].touchedAt ? a : b,
        )[0];
        this.profiles.delete(oldest);
      }
      profile = { textSamples: [], touchedAt: Date.now() };
      this.profiles.set(key, profile);
    }
    profile.touchedAt = Date.now();
    update(profile);
  }
}

export const durationEvidenceCache = new DurationEvidenceCache();

export function normalizeDurationTextKey(artist: string, title: string): string {
  return textKey(artist, title);
}

export function isUsableDuration(durationMs: number | null | undefined): durationMs is number {
  return validDuration(durationMs);
}
