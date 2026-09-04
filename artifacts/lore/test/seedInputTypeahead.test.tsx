// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const useSuggestArchiveArtists = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getSuggestArchiveArtistsQueryKey: (params: { q: string }) => ["artist-suggestions", params],
  useSuggestArchiveArtists: (...args: unknown[]) => useSuggestArchiveArtists(...args),
}));

import { SeedInput } from "../src/components/SeedInput";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("SeedInput artist typeahead", () => {
  it("exposes suggestions as a keyboard-selectable combobox", async () => {
    vi.useFakeTimers();
    useSuggestArchiveArtists.mockReturnValue({
      data: {
        query: "rad",
        suggestions: [
          { name: "Radiohead", playCount: 42 },
          { name: "Radio Dept., The", playCount: 7 },
        ],
      },
      isFetching: false,
    });
    const onAdd = vi.fn();
    render(<SeedInput seeds={[]} onAdd={onAdd} />);

    const input = screen.getByRole("combobox", { name: "Artist name" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "rad" } });
    await act(async () => vi.advanceTimersByTime(300));

    expect(screen.getByRole("listbox", { name: "Artist suggestions" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Radiohead" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("Radiohead");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("keeps free-text entry available when no suggestion matches", async () => {
    vi.useFakeTimers();
    useSuggestArchiveArtists.mockReturnValue({
      data: { query: "new act", suggestions: [] },
      isFetching: false,
    });
    const onAdd = vi.fn();
    render(<SeedInput seeds={[]} onAdd={onAdd} />);

    const input = screen.getByRole("combobox", { name: "Artist name" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "A New Act" } });
    await act(async () => vi.advanceTimersByTime(300));
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith("A New Act");
  });
});