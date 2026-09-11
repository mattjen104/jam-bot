// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LibraryStationFilters,
  deriveLibraryLens,
  writeLibraryLens,
} from "../src/components/LibraryMetadataFilters";
import { SPECIALIST_SUBCATEGORY_DEFINITIONS } from "../src/lib/specialistCategories";

describe("LibraryMetadataFilters", () => {
  it("maps old metadata links to Artist and preserves compatible station state", () => {
    expect(deriveLibraryLens("?focus=Broadcast")).toBe("artist");
    expect(deriveLibraryLens("?genre=electronic")).toBe("artist");
    expect(deriveLibraryLens("?age=deep&decade=1990")).toBe("artist");

    const params = new URLSearchParams("focus=Broadcast&genre=electronic&age=deep&decade=1990&categories=campus&layout=grid&sort=title");
    writeLibraryLens(params, "genre");
    expect(params.get("libraryLens")).toBe("artist");
    expect(params.get("focus")).toBe("Broadcast");
    expect(params.get("age")).toBeNull();
    expect(params.get("decade")).toBeNull();
    expect(params.get("genre")).toBeNull();
    expect(params.get("categories")).toBe("campus,specialist");
    expect(params.get("specialistCategories")).toBe("electronic,era");
    expect(params.get("layout")).toBe("grid");
    expect(params.get("sort")).toBe("title");
  });

  it("groups station filters, contains keyboard focus, clears all, and returns focus on Escape", async () => {
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
    const dialog = screen.getByRole("dialog", { name: "Station filters" });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Station type")).toBeTruthy();
    expect(screen.getByText("Bro Zones")).toBeTruthy();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const done = screen.getByRole("button", { name: "Done" });
    done.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(done);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledOnce();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(trigger);
  });

  it("reveals every shared Specialist choice only while Specialist is selected", () => {
    const onToggleSpecialistSubcategory = vi.fn();
    const props = {
      broZonesActive: false,
      broZones: new Set<never>(),
      broZoneCounts: {
        combined: 0,
        byZone: {
          seattle: 0, portland: 0, denver: 0, cleveland: 0,
          "los-angeles": 0, "redlands-inland-empire": 0,
          "washington-dc": 0, "north-carolina": 0,
        },
      },
      onToggleCategory: vi.fn(),
      onToggleBroZonesCollection: vi.fn(),
      onToggleBroZone: vi.fn(),
      onClear: vi.fn(),
      onToggleSpecialistSubcategory,
    };
    const view = render(<LibraryStationFilters {...props} categories={new Set(["campus"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters · 1" }));
    expect(screen.queryByText("Specialist sounds")).toBeNull();

    cleanup();
    view.unmount();
    render(
      <LibraryStationFilters
        {...props}
        categories={new Set(["specialist"])}
        specialistSubcategories={new Set(["ambient"])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filters · 2" }));
    expect(screen.getByText("Specialist sounds")).toBeTruthy();
    for (const { label } of SPECIALIST_SUBCATEGORY_DEFINITIONS) {
      expect(screen.getByRole("checkbox", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("checkbox", { name: "Jazz / Blues" }));
    expect(onToggleSpecialistSubcategory).toHaveBeenCalledWith("jazz");
  });
});