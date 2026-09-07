import { describe, expect, it, vi } from "vitest";
import { fetchSpinitronWebWithOutcome } from "../src/lore/adapters.js";

describe("structured spinitron_web outcomes", () => {
  it("preserves the upstream HTTP status without exposing request config", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const result = await fetchSpinitronWebWithOutcome(
      { callsign: "WPRB", ignoredSecret: "do-not-emit" },
      fetchFn,
    );

    expect(result).toEqual({
      nowPlaying: null,
      outcome: { kind: "http_error", status: 503 },
    });
  });

  it("reports timeouts separately from network failures", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const timeoutResult = await fetchSpinitronWebWithOutcome(
      { callsign: "WPRB" },
      vi.fn().mockRejectedValue(timeout),
    );
    const networkResult = await fetchSpinitronWebWithOutcome(
      { callsign: "WPRB" },
      vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    );

    expect(timeoutResult.outcome.kind).toBe("timeout");
    expect(networkResult.outcome.kind).toBe("network_error");
  });

  it("distinguishes a parse miss from transport success with a current track", async () => {
    const parseMiss = await fetchSpinitronWebWithOutcome(
      { callsign: "WPRB" },
      vi.fn().mockResolvedValue(
        new Response("<html><body>No current spin</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const success = await fetchSpinitronWebWithOutcome(
      { callsign: "WPRB" },
      vi.fn().mockResolvedValue(
        new Response(
          '<tr class="spin-item" data-spin="{&quot;a&quot;:&quot;Broadcast&quot;,&quot;s&quot;:&quot;Echo\\u0027s Answer&quot;}"></tr>',
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ),
    );

    expect(parseMiss.outcome).toEqual({ kind: "parser_error", status: 200 });
    expect(success.outcome).toEqual({ kind: "success", status: 200 });
    expect(success.nowPlaying).toEqual({
      rawArtist: "Broadcast",
      rawTitle: "Echo's Answer",
    });
  });
});