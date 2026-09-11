// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryMetadataFilters } from "../src/components/LibraryMetadataFilters";

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
    fireEvent.click(screen.getByRole("button", { name: "Genre" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Rock/ }));
    fireEvent.click(screen.getByRole("button", { name: "Track age" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Current/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Decade" }), { target: { value: "1990" } });
    expect(onGenresChange).toHaveBeenCalledWith(["rock"]);
    expect(onAgesChange).toHaveBeenCalledWith(["current"]);
    expect(onDecadeChange).toHaveBeenCalledWith(1990);
    expect(screen.getByRole("option", { name: "2020s" })).toBeTruthy();
  });
});