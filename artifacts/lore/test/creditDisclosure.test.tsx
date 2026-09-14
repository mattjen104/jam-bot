// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AlbumCreditsDisclosure, CreditSummary, CreditsDisclosure, KeptCreditSurface } from "../src/components/CreditDisclosure";
import { useAlbumCredits } from "../src/hooks/useAlbumCredits";
import { normalizeCreditPayload, type CreditPayload } from "../src/lib/creditPayload";

const ready: CreditPayload = {
  status: "ready",
  completeness: "complete",
  credits: [{
    group: "production",
    role: "producer",
    name: "Canonical Producer",
    identity: { id: "artist-1", type: "artist", name: "Canonical Producer" },
    approximate: false,
  }, {
    group: "production",
    role: "producer",
    name: "Approximate Producer",
    approximate: true,
  }],
  labels: [{ name: "Grounded Label", labelId: "label-1", approximate: false }],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("credit disclosure affordances", () => {
  it("links canonical identities but leaves approximate names and labels as text", () => {
    render(<CreditSummary payload={ready} returnTo="/library?view=songs" />);
    expect(screen.getByRole("link", { name: "Canonical Producer" }).getAttribute("href"))
      .toContain("/credits/artist/artist-1");
    expect(screen.queryByRole("link", { name: "Approximate Producer" })).toBeNull();
    expect(screen.getByRole("link", { name: "Grounded Label" }).getAttribute("href"))
      .toContain("/labels/label-1");
  });

  it("uses native disclosure semantics and exposes grouped credits", () => {
    render(<CreditsDisclosure payload={ready} />);
    const disclosure = screen.getByTestId("credits-disclosure");
    expect(disclosure.tagName).toBe("DETAILS");
    expect(screen.getByText("Credits & release").tagName).toBe("SUMMARY");
    expect(screen.getByRole("heading", { name: "Production" })).toBeTruthy();
    fireEvent.click(screen.getByText("Credits & release"));
    expect(disclosure.hasAttribute("open")).toBe(true);
  });

  it("renders an honest pending state rather than claiming no credits", () => {
    render(<CreditsDisclosure payload={{ credits: [], labels: [], completeness: "unknown", status: "pending" }} />);
    expect(screen.getByRole("status").textContent).toMatch(/still being verified/i);
  });

  it("discloses partial status and provenance only inside the expanded surface", () => {
    const payload: CreditPayload = {
      ...ready,
      status: "partial",
      completeness: "partial",
      source: "musicbrainz",
      parserVersion: "credits-v3",
      fetchedAt: "2024-01-02T00:00:00Z",
      stale: true,
    };
    render(<CreditsDisclosure payload={payload} />);
    expect(screen.getByText(/Partial verified coverage/i)).toBeTruthy();
    expect(screen.getByText(/Source: musicbrainz.*parser credits-v3.*may be stale/i)).toBeTruthy();
  });

  it("does not mount a credit surface for an unkept item", () => {
    const { rerender } = render(
      <KeptCreditSurface kept={false} payload={ready} />,
    );
    expect(screen.queryByTestId("kept-credit-surface")).toBeNull();
    rerender(<KeptCreditSurface kept payload={ready} />);
    expect(screen.getByTestId("kept-credit-surface")).toBeTruthy();
  });

  it("shows aggregated album production credits and per-track facts", () => {
    const payload = normalizeCreditPayload({
      releases: [{ labelName: "Grounded Label", labelMbid: "label-1" }],
      tracks: [{
        mbid: "track-1",
        title: "Track one",
        credits: [{ creditedName: "Canonical Producer", role: "producer", artistMbid: "artist-1" }],
      }],
    });
    render(<AlbumCreditsDisclosure payload={payload} />);
    expect(screen.getAllByRole("link", { name: "Canonical Producer" })).toHaveLength(3);
    fireEvent.click(screen.getByText("Track one"));
    expect(screen.getByText("Track credits")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Canonical Producer" })).toHaveLength(3);
  });
});

function AlbumCreditProbe() {
  const query = useAlbumCredits("release-group-1", true);
  return <output data-testid="album-credit-status">{query.data?.status ?? "loading"}</output>;
}

describe("album credits batching", () => {
  it("uses one generated album-credit query for all tracks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      album: { mbid: "release-group-1" },
      tracks: [
        { mbid: "track-1", title: "One", credits: [] },
        { mbid: "track-2", title: "Two", credits: [] },
      ],
      releases: [],
      status: "partial",
      provenance: { source: "musicbrainz" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AlbumCreditProbe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("album-credit-status").textContent).toBe("partial"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/me/credits/albums/release-group-1");
  });
});