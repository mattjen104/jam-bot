// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LibraryMetadataFilters,
  LibraryStationFilters,
  deriveLibraryLens,
  writeLibraryLens,
} from "../src/components/LibraryMetadataFilters";

describe("LibraryMetadataFilters", () => {
  it("supports genre, age and decade changes", () => {
    const onGenresChange = vi.fn();
    const onAgesChange = vi.fn();
    const onDecadeChange = vi.fn();
    render(
      <LibraryMetadataFilters
        genres={[]}
        ages={[]}
        decadeOptions={[2020, 1990]}
        onGenresChange={onGenresChange}
        onAgesChange={onAgesChange}
        onDecadeChange={onDecadeChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Choose genre" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Rock/ }));
    fireEvent.click(screen.getByRole("button", { name: "Browse era" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Current/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Decade" }), { target: { value: "1990" } });
    expect(onGenresChange).toHaveBeenCalledWith(["rock"]);
    expect(onAgesChange).toHaveBeenCalledWith(["current"]);
    expect(onDecadeChange).toHaveBeenCalledWith(1990);
    expect(screen.getByRole("option", { name: "2020s" })).toBeTruthy();
  });

  it("maps old links to one lens and clears incompatible lens state when switching", () => {
    expect(deriveLibraryLens("?focus=Broadcast")).toBe("artist");
    expect(deriveLibraryLens("?genre=electronic")).toBe("genre");
    expect(deriveLibraryLens("?age=deep&decade=1990")).toBe("era");

    const params = new URLSearchParams("focus=Broadcast&genre=electronic&age=deep&decade=1990&categories=campus&layout=grid&sort=title");
    writeLibraryLens(params, "genre");
    expect(params.get("libraryLens")).toBe("genre");
    expect(params.get("focus")).toBeNull();
    expect(params.get("age")).toBeNull();
    expect(params.get("decade")).toBeNull();
    expect(params.get("genre")).toBe("electronic");
    expect(params.get("categories")).toBe("campus");
    expect(params.get("layout")).toBe("grid");
    expect(params.get("sort")).toBe("title");
  });

  it("groups station filters, reports the active count, clears all, and returns focus on Escape", () => {
    cleanup();
    const onClear = vi.fn();
    render(
      <LibraryStationFilters
        categories={new Set(["campus"])}
        broZonesActive
        broZones={new Set(["seattle"])}
        broZoneCounts={{
          combined: 3,
          byZone: {
            seattle: 1, portland: 0, denver: 0, cleveland: 0,
            "los-angeles": 1, "redlands-inland-empire": 0,
            "washington-dc": 0, "north-carolina": 1,
          },
        }}
        onToggleCategory={vi.fn()}
        onToggleBroZonesCollection={vi.fn()}
        onToggleBroZone={vi.fn()}
        onClear={onClear}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Filters · 2" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Station filters" })).toBeTruthy();
    expect(screen.getByText("Station type")).toBeTruthy();
    expect(screen.getByText("Bro Zones")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });
});