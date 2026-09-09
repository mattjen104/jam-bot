// Retired UI: Press/Radio unified-feed lens specs were replaced by the current Stations/Scan control.
// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DialLensBar } from "../src/components/dial/DialLensBar";

afterEach(cleanup);

describe("Explore view control", () => {
  it("presents Stations as the active default view", () => {
    render(<DialLensBar lens="radio" onSetLens={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Stations" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Scan" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens Scan through its dedicated action", () => {
    const setLens = vi.fn();
    const openScan = vi.fn();
    render(<DialLensBar lens="radio" onSetLens={setLens} onOpenScan={openScan} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(setLens).toHaveBeenCalledWith("scan");
    expect(openScan).toHaveBeenCalledOnce();
  });
});