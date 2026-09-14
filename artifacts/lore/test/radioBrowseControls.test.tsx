// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RadioBrowseControls } from "../src/components/RadioBrowseControls";
import { createRadioBrowseState } from "../src/lib/radioBrowseState";

describe("RadioBrowseControls", () => {
  afterEach(cleanup);

  it("offers exclusive lenses as pressed buttons and a single progressively disclosed filter entry", () => {
    const changes: ReturnType<typeof createRadioBrowseState>[] = [];
    render(
      <RadioBrowseControls
        state={createRadioBrowseState()}
        onStateChange={(next) => changes.push(next)}
        resultCount={4}
      />,
    );
    expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.queryByText("Station type")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByText("Station type")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Specialist" }));
    expect(changes.at(-1)?.filters.stationTypes).toContain("specialist");
    expect(screen.getByRole("button", { name: "Core" })).toBeTruthy();
  });

  it("does not unlock For You merely because locality is known", () => {
    render(
      <RadioBrowseControls
        state={createRadioBrowseState({ locality: { zip: "02139" } })}
        hasTasteEvidence={false}
        onStateChange={() => undefined}
        resultCount={0}
      />,
    );
    expect(screen.queryByRole("button", { name: "For You" })).toBeNull();
  });

  it("keeps a locality coarse and clearable", () => {
    const changes: ReturnType<typeof createRadioBrowseState>[] = [];
    const state = createRadioBrowseState({ locality: { zip: "02139" } });
    render(
      <RadioBrowseControls
        state={state}
        onStateChange={(next) => changes.push(next)}
        onLocalityChange={(locality) => {
          if (!locality) changes.push({ ...state, locality: null });
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Coarse locality set/ }));
    fireEvent.click(screen.getByRole("button", { name: /Clear locality/ }));
    expect(changes.at(-1)?.locality).toBeNull();
    expect(screen.getByText(/coarse ZIP/i)).toBeTruthy();
  });

  it("changes playing-now, support, followed, and Bro Zone filters", () => {
    const changes: ReturnType<typeof createRadioBrowseState>[] = [];
    render(
      <RadioBrowseControls
        state={createRadioBrowseState()}
        onStateChange={(next) => changes.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    fireEvent.click(screen.getByRole("button", { name: "Playing now · Deep" }));
    fireEvent.click(screen.getByRole("button", { name: "Seattle" }));
    fireEvent.click(screen.getByLabelText("Followed stations only"));
    fireEvent.click(screen.getByLabelText("Stations with support info"));
    expect(changes[0].filters.playingNow).toEqual(["deep"]);
    expect(changes[1].filters.broZones).toEqual(["seattle"]);
    expect(changes[2].filters.followedOnly).toBe(true);
    expect(changes[3].filters.supportOnly).toBe(true);
  });
});