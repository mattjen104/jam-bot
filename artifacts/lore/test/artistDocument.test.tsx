// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ArtistDocument } from "../src/components/ArtistDocument";
import { parseArtistDocument } from "../src/lib/artistDocument";

afterEach(() => cleanup());

describe("ArtistDocument", () => {
  it("starts blank and saves a trimmed, case-insensitively deduplicated document", async () => {
    const onSave = vi.fn(async (artists: string[]) => artists);
    render(<ArtistDocument artists={[]} onSave={onSave} onClose={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "Artists, one per line" });
    expect((input as HTMLTextAreaElement).value).toBe("");
    fireEvent.change(input, { target: { value: "Radiohead\n radiohead \nPortishead" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artists" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(["Radiohead", "Portishead"]));
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("surfaces write failures without claiming the edited list was saved", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("The artist list could not be saved.");
    });
    render(<ArtistDocument artists={["Confirmed"]} onSave={onSave} onClose={vi.fn()} />);

    const input = screen.getByRole("textbox", { name: "Artists, one per line" });
    fireEvent.change(input, { target: { value: "Replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artists" }));

    expect((await screen.findByRole("alert")).textContent).toContain("could not be saved");
    expect((input as HTMLTextAreaElement).value).toBe("Replacement");
  });

  it("updates an open document when the canonical list changes elsewhere", () => {
    const { rerender } = render(
      <ArtistDocument artists={["Radiohead"]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(
      <ArtistDocument artists={["Radiohead", "Broadcast"]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect((screen.getByRole("textbox", { name: "Artists, one per line" }) as HTMLTextAreaElement).value)
      .toBe("Radiohead\nBroadcast");
  });

  it("merges CLI additions into a dirty document without discarding its draft", () => {
    const { rerender } = render(
      <ArtistDocument artists={["Radiohead"]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByRole("textbox", { name: "Artists, one per line" });
    fireEvent.change(input, { target: { value: "Radiohead\nDraft Artist" } });
    rerender(
      <ArtistDocument
        artists={["Radiohead", "Broadcast"]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect((input as HTMLTextAreaElement).value).toBe("Radiohead\nDraft Artist\nBroadcast");
  });

  it("keeps the submitted draft when an optimistic write rolls back", async () => {
    let rejectSave: ((reason: Error) => void) | undefined;
    const onSave = vi.fn(() => new Promise((_resolve, reject) => {
      rejectSave = reject;
    }));
    const { rerender } = render(
      <ArtistDocument artists={["Confirmed"]} onSave={onSave} onClose={vi.fn()} />,
    );
    const input = screen.getByRole("textbox", { name: "Artists, one per line" });
    fireEvent.change(input, { target: { value: "Replacement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save artists" }));

    rerender(<ArtistDocument artists={["Replacement"]} onSave={onSave} onClose={vi.fn()} />);
    rerender(<ArtistDocument artists={["Confirmed"]} onSave={onSave} onClose={vi.fn()} />);
    rejectSave?.(new Error("Write failed"));

    expect((await screen.findByRole("alert")).textContent).toContain("Write failed");
    expect((input as HTMLTextAreaElement).value).toBe("Replacement");
  });

  it("preserves an invalid raw draft when a CLI artist arrives", () => {
    const invalidDraft = "x".repeat(101);
    const { rerender } = render(
      <ArtistDocument artists={[]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    const input = screen.getByRole("textbox", { name: "Artists, one per line" });
    fireEvent.change(input, { target: { value: invalidDraft } });
    rerender(
      <ArtistDocument artists={["Broadcast"]} onSave={vi.fn()} onClose={vi.fn()} />,
    );
    expect((input as HTMLTextAreaElement).value).toBe(`${invalidDraft}\nBroadcast`);
  });

  it("rejects overlong names and lists above the persisted limit", () => {
    expect(parseArtistDocument("x".repeat(101)).error).toContain("100");
    expect(parseArtistDocument(Array.from({ length: 51 }, (_, index) => `Artist ${index}`).join("\n")).error)
      .toContain("50");
  });
});