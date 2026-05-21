/**
 * In-process async mutex for playback-mutating operations.
 *
 * Multiple Slack commands can race against each other: two friends
 * running `/play` within seconds of each other, or `/memory` (which
 * issues many `addToQueue` calls in a loop) overlapping with a `/play`.
 * Spotify processes each request independently, so racing calls cause
 * listeners to hear "the bot jumping between songs" or queue contents
 * to interleave between sets.
 *
 * Serializing every playback-mutation path through this mutex makes
 * the bot's commands behave like a single ordered conversation with
 * Spotify, at the cost of a small wait for the second caller. If the
 * lock isn't released within `timeoutMs` (default 5s), the second
 * caller's `withPlaybackLock` rejects with `PlaybackLockBusyError` so
 * the handler can reply to the user instead of hanging.
 */

export class PlaybackLockBusyError extends Error {
  constructor() {
    super("playback lock busy");
    this.name = "PlaybackLockBusyError";
  }
}

class PlaybackMutex {
  private locked = false;
  private waiters: Array<() => void> = [];

  acquire(timeoutMs: number): Promise<() => void> {
    return new Promise<() => void>((resolve, reject) => {
      const grant = () => {
        this.locked = true;
        resolve(() => this.release());
      };
      if (!this.locked) {
        grant();
        return;
      }
      let onReady: () => void;
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(onReady);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new PlaybackLockBusyError());
      }, timeoutMs);
      onReady = () => {
        clearTimeout(timer);
        grant();
      };
      this.waiters.push(onReady);
    });
  }

  private release() {
    const next = this.waiters.shift();
    if (next) {
      // Hand the lock directly to the next waiter — do not flip
      // `locked` to false in between, or another acquire() call could
      // race in and starve the waiter.
      next();
    } else {
      this.locked = false;
    }
  }
}

const playbackMutex = new PlaybackMutex();

export async function withPlaybackLock<T>(
  fn: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const release = await playbackMutex.acquire(timeoutMs);
  try {
    return await fn();
  } finally {
    release();
  }
}
