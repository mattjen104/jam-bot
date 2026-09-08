import { describe, expect, it } from "vitest";
import { inferTimezone } from "../src/lore/timezone.js";

describe("inferTimezone", () => {
  it.each([
    ["San Jose", "America/Los_Angeles"],
    ["Bridgeport", "America/New_York"],
    ["Athens", "America/New_York"],
  ])("maps reviewed US station city %s", (city, expected) => {
    expect(inferTimezone(city, "US")).toBe(expected);
  });
});