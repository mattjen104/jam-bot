import { describe, it, expect } from "vitest";
import { detectAdSignal, AD_SIGNAL_THRESHOLD } from "../src/lore/ads.js";

describe("detectAdSignal", () => {
  it("flags an explicit ad-break announcement", () => {
    expect(
      detectAdSignal("Station", "This station will continue after this break"),
    ).toBe(true);
  });

  it("flags a sponsor read", () => {
    expect(detectAdSignal("Acme Corp", "Brought to you by Acme Corp")).toBe(
      true,
    );
  });

  it("flags identical artist/title filler mentioning a promo keyword", () => {
    expect(detectAdSignal("Commercial Break", "Commercial Break")).toBe(true);
  });

  it("does not flag a real song", () => {
    expect(detectAdSignal("Fleetwood Mac", "Go Your Own Way")).toBe(false);
  });

  it("does not flag empty metadata", () => {
    expect(detectAdSignal(null, undefined)).toBe(false);
  });

  it("never flags a station proudly branded commercial-free", () => {
    expect(
      detectAdSignal("KEXP", "100% commercial-free listener-supported radio"),
    ).toBe(false);
  });

  it("does not flag identical artist/title without a promo keyword", () => {
    // A real (if unusual) song could repeat its title as the artist field;
    // only flag same-field filler when it also carries a promo keyword.
    expect(detectAdSignal("Interlude", "Interlude")).toBe(false);
  });
});

describe("AD_SIGNAL_THRESHOLD", () => {
  it("requires more than one consecutive signal", () => {
    expect(AD_SIGNAL_THRESHOLD).toBeGreaterThan(1);
  });
});
