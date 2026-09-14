/**
 * Tiny audio-ownership bridge shared by the module-level inline preview and
 * PlayerProvider.
 *
 * Keeping this state in its own leaf module is intentional: inlinePreview
 * must not import PlayerProvider (and vice versa), while either side still
 * needs to synchronously yield the shared audio surface to the other.
 */

export type AudioHandoffRelease = () => void | Promise<void>;
export type AudioHandoff = () => void | Promise<void | AudioHandoffRelease>;

let playerHandoff: AudioHandoff | null = null;
let inlineStopper: (() => void) | null = null;
let inlineRelease: AudioHandoffRelease | null = null;
let inlineClaim: Promise<void> | null = null;
let ownershipGeneration = 0;

export function registerPlayerAudioHandoff(
  handoff: AudioHandoff,
): () => void {
  playerHandoff = handoff;
  return () => {
    if (playerHandoff === handoff) playerHandoff = null;
  };
}

export function registerInlinePreviewStopper(
  stopper: () => void,
): () => void {
  inlineStopper = stopper;
  return () => {
    if (inlineStopper === stopper) inlineStopper = null;
  };
}

/** Yield PlayerProvider-owned audio before an inline preview is started. */
export async function claimInlinePreview(): Promise<void> {
  // Inline clips are one transport. Replacing A with B must retain the lease
  // that paused radio/cast rather than pausing the already-paused owner again.
  if (inlineRelease) return;
  if (inlineClaim) return inlineClaim;
  const generation = ++ownershipGeneration;
  const claim = (async () => {
    const release = await playerHandoff?.();
    if (generation !== ownershipGeneration) {
      // A newer owner won while the asynchronous pause was in flight. Undo
      // whatever this stale handoff acquired instead of stranding it paused.
      if (typeof release === "function") await release();
      return;
    }
    inlineRelease = typeof release === "function" ? release : null;
  })();
  inlineClaim = claim;
  try {
    await claim;
  } finally {
    if (inlineClaim === claim) inlineClaim = null;
  }
}

/** Yield the inline preview before PlayerProvider starts any audio. */
export function claimPlayerAudio(): void {
  // A new PlayerProvider owner supersedes the paused owner; do not resume it
  // when stopping the old inline clip.
  ++ownershipGeneration;
  inlineRelease = null;
  inlineStopper?.();
}

/** Claim the shared surface immediately before a paused player resumes. */
export function resumePlayerAudio(resume: () => void): void {
  claimPlayerAudio();
  resume();
}

/** Release a paused PlayerProvider owner after the inline clip ends/stops. */
export function releaseInlinePreview(): void {
  ++ownershipGeneration;
  const release = inlineRelease;
  inlineRelease = null;
  void release?.();
}
