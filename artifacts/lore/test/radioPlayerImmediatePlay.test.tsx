// @vitest-environment jsdom
/**
 * Regression test: the live-radio audio element must exist for a play/toggle
 * that fires immediately after mount — i.e. before (or regardless of) the
 * mount effect that wires listeners. The lazy `ensureAudio()` path inside the
 * event handlers guarantees this; a mount-effect-only creation would silently
 * drop the listener's first interaction.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, act } from "@testing-library/react";
import type { Station } from "@workspace/api-client-react";
import { useRadioPlayer } from "../src/hooks/useRadioPlayer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const station = {
  slug: "kexp",
  name: "KEXP",
  streamUrl: "https://example.test/stream.mp3",
  streamFormat: "mp3",
} as unknown as Station;

function Harness({ onApi }: { onApi: (api: ReturnType<typeof useRadioPlayer>) => void }) {
  onApi(useRadioPlayer());
  return null;
}

describe("useRadioPlayer — immediate first interaction", () => {
  it("play() right after mount attaches the stream and calls audio.play()", async () => {
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const loadSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, "load")
      .mockImplementation(() => {});

    let api: ReturnType<typeof useRadioPlayer> | null = null;
    render(<Harness onApi={(a) => { api = a; }} />);

    // Fire the interaction synchronously with the first commit — no waiting
    // for effects beyond what render() already flushed.
    await act(async () => {
      await api!.play(station);
    });

    expect(loadSpy).toHaveBeenCalled();
    expect(playSpy).toHaveBeenCalled();
    expect(api!.status === "loading" || api!.status === "playing").toBe(true);
    expect(api!.station?.slug).toBe("kexp");
  });

  it("toggle() as the very first action starts playback (does not silently no-op)", async () => {
    const playSpy = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => {});

    let api: ReturnType<typeof useRadioPlayer> | null = null;
    render(<Harness onApi={(a) => { api = a; }} />);

    await act(async () => {
      await api!.toggle(station);
    });

    expect(playSpy).toHaveBeenCalled();
    expect(api!.station?.slug).toBe("kexp");
  });
});
