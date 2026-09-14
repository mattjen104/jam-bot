// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class PreviewAudio extends EventTarget {
  static instances: PreviewAudio[] = [];
  paused = true;
  preload = "";
  volume = 1;
  duration = 30;
  currentTime = 0;
  private source = "";
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  load = vi.fn();
  set src(value: string) {
    this.source = value;
  }
  get src() {
    return this.source;
  }
  removeAttribute(name: string) {
    if (name === "src") this.source = "";
  }

  constructor() {
    super();
    PreviewAudio.instances.push(this);
  }
}

vi.stubGlobal("Audio", PreviewAudio);

const { toggleInlinePreview, stopInlinePreview } = await import(
  "../src/player/inlinePreview"
);
const { claimPlayerAudio, registerPlayerAudioHandoff, resumePlayerAudio } = await import(
  "../src/player/audioOwnership"
);

beforeEach(() => {
  stopInlinePreview();
});

afterEach(() => {
  stopInlinePreview();
  vi.restoreAllMocks();
});

describe("inline preview audio ownership", () => {
  it("waits for the PlayerProvider handoff before playing", async () => {
    const handoff = vi.fn(async () => {});
    const unregister = registerPlayerAudioHandoff(handoff);

    await expect(
      toggleInlinePreview("mbid-1", "https://example.test/preview.m4a"),
    ).resolves.toBe("playing");

    expect(handoff).toHaveBeenCalledTimes(1);
    expect(PreviewAudio.instances[0]?.src).toBe(
      "https://example.test/preview.m4a",
    );
    unregister();
  });

  it("returns the paused owner when the preview ends", async () => {
    const release = vi.fn();
    const unregister = registerPlayerAudioHandoff(() => release);

    await toggleInlinePreview("mbid-release", "https://example.test/release.m4a");
    stopInlinePreview();

    expect(release).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("retains one owner lease across A to B replacement", async () => {
    const release = vi.fn();
    const handoff = vi.fn(() => release);
    const unregister = registerPlayerAudioHandoff(handoff);

    await toggleInlinePreview("mbid-a", "https://example.test/a.m4a");
    await toggleInlinePreview("mbid-b", "https://example.test/b.m4a");
    stopInlinePreview();

    expect(handoff).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("shares an in-flight lease and releases a stale acquired handoff", async () => {
    let resolveHandoff!: (release: () => void) => void;
    const release = vi.fn();
    const handoff = vi.fn(() => new Promise<() => void>((resolve) => {
      resolveHandoff = resolve;
    }));
    const unregister = registerPlayerAudioHandoff(handoff);

    const first = toggleInlinePreview("mbid-a", "https://example.test/a.m4a");
    const second = toggleInlinePreview("mbid-b", "https://example.test/b.m4a");
    expect(handoff).toHaveBeenCalledTimes(1);
    claimPlayerAudio();
    resolveHandoff(release);

    await expect(first).resolves.toBe("stopped");
    await expect(second).resolves.toBe("stopped");
    expect(release).toHaveBeenCalledTimes(1);
    unregister();
  });

  it("stale play promises cannot resurrect a preview after a stop", async () => {
    const result = toggleInlinePreview("mbid-2", "https://example.test/a.m4a");
    stopInlinePreview();

    await expect(result).resolves.toBe("stopped");
    expect(PreviewAudio.instances.at(-1)?.src).not.toBe(
      "https://example.test/a.m4a",
    );
  });

  it("cleans the source when playback rejects", async () => {
    await toggleInlinePreview("mbid-3", "https://example.test/b.m4a");
    const el = PreviewAudio.instances.at(-1)!;
    el.play.mockRejectedValueOnce(new Error("blocked"));
    await expect(
      toggleInlinePreview("mbid-4", "https://example.test/c.m4a"),
    ).resolves.toBe("unavailable");
    expect(el.src).toBe("");
  });

  it("a PlayerProvider claim stops and cleans the shared preview source", async () => {
    await toggleInlinePreview("mbid-5", "https://example.test/b.m4a");
    const el = PreviewAudio.instances.at(-1)!;

    claimPlayerAudio();

    expect(el.pause).toHaveBeenCalled();
    expect(el.src).toBe("");
  });

  it("a paused player resume takes ownership before restarting", async () => {
    await toggleInlinePreview("mbid-resume", "https://example.test/resume.m4a");
    const el = PreviewAudio.instances.at(-1)!;
    const resume = vi.fn();

    resumePlayerAudio(resume);

    expect(el.src).toBe("");
    expect(el.pause).toHaveBeenCalled();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume.mock.invocationCallOrder[0]).toBeGreaterThan(
      el.pause.mock.invocationCallOrder.at(-1)!,
    );
  });
});
