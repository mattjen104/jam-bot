// @vitest-environment jsdom
/**
 * LandingConfirmationNote — quiet handoff status rendering:
 *  - confirming → "checking live metadata…" (soft, non-blocking);
 *  - unconfirmed → "live metadata may be delayed" (never negative wording);
 *  - confirmed → renders nothing (clears the hint);
 *  - only renders for the currently tuned station.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LandingConfirmationNote } from "../src/components/dial/LandingConfirmationNote";

describe("LandingConfirmationNote", () => {
  afterEach(cleanup);
  it("shows the checking state while confirming", () => {
    render(
      <LandingConfirmationNote
        confirmation={{ slug: "kfoo", phase: "confirming" }}
        activeSlug="kfoo"
      />,
    );
    const note = screen.getByTestId("dial-landing-note");
    expect(note.textContent).toBe("checking live metadata…");
    expect(note.dataset.phase).toBe("confirming");
  });

  it("shows the soft delayed state when unconfirmed — no negative wording", () => {
    render(
      <LandingConfirmationNote
        confirmation={{ slug: "kfoo", phase: "unconfirmed" }}
        activeSlug="kfoo"
      />,
    );
    const note = screen.getByTestId("dial-landing-note");
    expect(note.textContent).toBe("live metadata may be delayed");
    expect(note.textContent).not.toMatch(/no match|nothing playing/i);
  });

  it("renders nothing when confirmed", () => {
    render(
      <LandingConfirmationNote
        confirmation={{ slug: "kfoo", phase: "confirmed" }}
        activeSlug="kfoo"
      />,
    );
    expect(screen.queryByTestId("dial-landing-note")).toBeNull();
  });

  it("renders nothing for a station that is no longer tuned", () => {
    render(
      <LandingConfirmationNote
        confirmation={{ slug: "kfoo", phase: "unconfirmed" }}
        activeSlug="kbar"
      />,
    );
    expect(screen.queryByTestId("dial-landing-note")).toBeNull();
  });

  it("renders nothing before any landing or with no active station", () => {
    const { rerender } = render(
      <LandingConfirmationNote confirmation={null} activeSlug="kfoo" />,
    );
    expect(screen.queryByTestId("dial-landing-note")).toBeNull();
    rerender(
      <LandingConfirmationNote
        confirmation={{ slug: "kfoo", phase: "confirming" }}
        activeSlug={null}
      />,
    );
    expect(screen.queryByTestId("dial-landing-note")).toBeNull();
  });
});
