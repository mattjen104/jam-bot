// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/api-client-react", () => ({
  useListPickers: vi.fn(),
  useGetPickersDial: vi.fn(() => ({ data: { items: [] } })),
  useListSelectors: vi.fn(() => ({ data: { selectors: [] }, isLoading: false })),
  useLookupPickedMbids: vi.fn(() => ({ data: { items: [] } })),
  getLookupPickedMbidsQueryKey: vi.fn(() => ["picked-mbids"]),
  getPickerRun: vi.fn(),
}));

vi.mock("../src/lib/meHooks", () => ({
  useMyLibrary: vi.fn(() => ({ data: { items: [] } })),
  useMyOverlapSelectors: vi.fn(() => ({ data: [] })),
  useMyPressPublicationsList: vi.fn(),
}));

vi.mock("../src/player/PlayerProvider", () => ({
  usePlayer: vi.fn(() => ({ radio: {} })),
}));

import { useListPickers } from "@workspace/api-client-react";
import { useMyPressPublicationsList } from "../src/lib/meHooks";
import Selectors from "../src/pages/Selectors";

describe("Selectors Press publication directory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useListPickers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        pickers: [{
          id: 10,
          handle: "test-publication",
          name: "Test Publication",
          active: true,
          pickerType: "blog",
          trustTier: 2,
          tags: [],
          homeUrl: "https://publisher.example",
        }],
      },
      isLoading: false,
      isError: false,
    });
    (useMyPressPublicationsList as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [{
        id: 10,
        handle: "test-publication",
        name: "Test Publication",
        articleCount: 42,
        overlapCount: 3,
        tags: [],
        health: null,
        sourceRef: { feedUrl: "https://publisher.example/feed" },
      }],
      isLoading: false,
    });
  });

  it("renders an RSS publication exactly once as Press and counts it once", () => {
    const { container } = render(<Selectors />);
    expect(screen.getAllByText("Test Publication")).toHaveLength(1);
    expect(screen.getAllByTestId("selector-card-press")).toHaveLength(1);
    expect(screen.queryByTestId("selector-card-curated")).toBeNull();
    expect(container.querySelector(".dial-topbar__sort-chip")?.textContent).toContain("1");
  });
});