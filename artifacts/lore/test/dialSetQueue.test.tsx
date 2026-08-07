// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SetQueueList } from "../src/components/DialView";

afterEach(() => cleanup());

describe("Dial set queue", () => {
  it("keeps spin order, renders completed artists white, and toggles seeded artists", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <SetQueueList
        artists={[
          { name: "First Artist", inLibrary: false },
          { name: "Second Artist", inLibrary: true },
          { name: "Third Artist", inLibrary: false },
        ]}
        seedsLower={new Set(["third artist"])}
        onAdd={onAdd}
        onRemove={onRemove}
        progress={2 / 3}
      />,
    );

    const names = [...document.querySelectorAll(".set-queue__artist")].map((node) => node.textContent);
    expect(names).toEqual(["First Artist", "Second Artist", "Third Artist"]);
    expect(screen.getByRole("button", { name: /add first artist/i }).className).toContain("set-queue__artist--add");
    expect(screen.getByRole("button", { name: /second artist is in your library/i }).className).toContain("set-queue__artist--library");
    expect(screen.getByRole("button", { name: /remove third artist/i }).className).toContain("set-queue__artist--library");

    fireEvent.click(screen.getByRole("button", { name: /add first artist/i }));
    fireEvent.click(screen.getByRole("button", { name: /remove third artist/i }));
    expect(onAdd).toHaveBeenCalledWith("First Artist");
    expect(onRemove).toHaveBeenCalledWith("Third Artist");
    expect(document.querySelector(".set-queue__progress")?.getAttribute("style")).toContain("width: 66.666");
  });
});