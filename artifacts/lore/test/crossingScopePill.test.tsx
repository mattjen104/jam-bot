// @vitest-environment jsdom
/** CrossingScopePill — the global scope control next to the crossings toggle. */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { CrossingScopePill } from "../src/components/dial/CrossingScopePill";

afterEach(cleanup);

describe("CrossingScopePill", () => {
  it("shows the current scope label and fires onCycle on tap", () => {
    const onCycle = vi.fn();
    const { container } = render(
      <CrossingScopePill scope="set" enabled onCycle={onCycle} />,
    );
    const pill = container.querySelector(".crossing-scope-pill")!;
    expect(pill.textContent).toContain("this set");
    fireEvent.click(pill);
    expect(onCycle).toHaveBeenCalledTimes(1);
  });

  it("is disabled and inert when crossings are off", () => {
    const onCycle = vi.fn();
    const { container } = render(
      <CrossingScopePill scope="24h" enabled={false} onCycle={onCycle} />,
    );
    const pill = container.querySelector(".crossing-scope-pill") as HTMLButtonElement;
    expect(pill.disabled).toBe(true);
    expect(pill.classList.contains("crossing-scope-pill--disabled")).toBe(true);
    fireEvent.click(pill);
    expect(onCycle).not.toHaveBeenCalled();
  });

  it("labels each scope distinctly across the cycle", () => {
    const labels: string[] = [];
    for (const scope of ["now", "set", "24h", "7d", "lifetime"] as const) {
      const { container, unmount } = render(
        <CrossingScopePill scope={scope} enabled onCycle={vi.fn()} />,
      );
      labels.push(container.querySelector(".crossing-scope-pill")!.textContent!.trim());
      unmount();
    }
    expect(labels).toEqual(["now ▾", "this set ▾", "24h ▾", "7d ▾", "lifetime ▾"]);
  });
});
