// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  connections: null as null | Array<{ service: string }>,
  startConnect: vi.fn(),
  keep: vi.fn(),
}));

vi.mock("../src/lib/meHooks", () => ({
  useMyConnections: () => ({ data: state.connections, isLoading: false }),
  useAppConfig: () => ({ data: { demoSurface: true } }),
  useMyKeepStatus: () => ({ data: new Set<string>() }),
  useMySpinKeepStatus: () => ({ data: { saved: new Set<number>(), pending: new Set<number>() } }),
  useMutationKeep: () => ({ isPending: false, mutate: state.keep }),
  useMutationKeepSpin: () => ({ isPending: false, mutate: vi.fn() }),
  useMutationUnkeep: () => ({ isPending: false, mutate: vi.fn() }),
  useMutationUnkeepSpin: () => ({ isPending: false, mutate: vi.fn() }),
  startSpotifyLibraryConnect: state.startConnect,
}));

import { KeepButton } from "../src/components/KeepButton";

describe("KeepButton on the focused demo surface", () => {
  beforeEach(() => {
    state.connections = null;
    state.startConnect.mockReset();
    state.keep.mockReset();
  });

  afterEach(cleanup);

  it("never opens Spotify when the device connection read is unavailable", () => {
    render(<KeepButton mbid="recording-1" compact />);
    fireEvent.click(screen.getByRole("button", { name: /temporarily unavailable/i }));
    expect(state.startConnect).not.toHaveBeenCalled();
  });

  it("saves directly for a fresh device with no connected services", () => {
    state.connections = [];
    render(<KeepButton mbid="recording-1" compact />);
    fireEvent.click(screen.getByRole("button", { name: /keep this track/i }));
    expect(state.keep).toHaveBeenCalledWith({
      mbid: "recording-1",
      spinId: undefined,
      provenance: undefined,
    });
    expect(state.startConnect).not.toHaveBeenCalled();
  });
});