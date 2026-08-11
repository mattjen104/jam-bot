/**
 * Browser-level playability check for the five newly-added HTTPS stations.
 *
 * Uses a real HTMLAudioElement in headless Chromium (via page.evaluate) to
 * confirm each stream URL plays audio without mixed-content errors. Combines
 * three independent verification layers:
 *
 *   1. Network layer (Playwright request interception):
 *      All requests to the stream host — including any intermediate redirects —
 *      are captured and asserted to be HTTPS. A redirect to HTTP would be
 *      flagged here before the audio element even sees it.
 *
 *   2. Playback layer (HTMLAudioElement.play() → `playing` event):
 *      `play()` is called on a muted audio element and the `playing` event is
 *      awaited. `playing` fires only after the browser has decoded at least one
 *      audio frame — proving the full pipeline (network → demux → decode) ran
 *      successfully. On mixed-content block the network request never completes
 *      and `playing` does not fire.
 *
 *   3. Origin layer (HTTPS Lore document):
 *      When REPLIT_DEV_DOMAIN is set (Replit environment) the test navigates
 *      to the HTTPS Lore domain, so Chromium's mixed-content policy is active.
 *      In a local development setup without TLS the test falls back to the
 *      HTTP dev server; the network-layer and playback-layer checks still catch
 *      HTTP redirects even without HTTPS-document enforcement.
 *
 * Why HTMLAudioElement and not fetch():
 *   The Lore player creates `new Audio()` and sets `el.src` directly — it does
 *   NOT set `crossOrigin` and does NOT use Web Audio API or canvas. Plain <audio
 *   src> cross-origin playback is NOT subject to CORS restrictions on data
 *   access; the browser fetches and decodes the stream regardless of whether
 *   the server sends Access-Control-Allow-Origin. A fetch()-based test would
 *   impose CORS rules the real player never sees.
 *
 * Why muted playback:
 *   Chromium always permits muted autoplay regardless of autoplay policy.
 *   Muting avoids the user-gesture requirement while still exercising the full
 *   media pipeline: network load, codec decode, and the `playing` event.
 *
 * This spec is intentionally NOT included in run-e2e-suite-gate.sh because it
 * makes real network requests to five live external radio streams — any of
 * which could be temporarily unreachable during an unrelated CI run. Run it
 * manually when adding or changing stream URLs to verify browser safety:
 *
 *   # Against the local HTTP dev server (all three checks active except HTTPS
 *   # document origin — mixed-content policy uses HTTP relaxed rules):
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *     PLAYWRIGHT_BASE_URL=http://localhost:80 \
 *     pnpm exec playwright test e2e/streamPlayability.spec.ts
 *
 *   # Against the Replit HTTPS domain (all three checks active including
 *   # HTTPS-document mixed-content enforcement):
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(which chromium) \
 *     REPLIT_DEV_DOMAIN=<your-repl>.replit.dev \
 *     pnpm exec playwright test e2e/streamPlayability.spec.ts
 *
 * Stations under test (all verified 200 audio/mpeg over HTTPS, 2026-08):
 *   WHPK   https://whpk-stream.uchicago.edu/stream        (Icecast, ACAO:*)
 *   WZBC   https://stream.wzbc.org/wzbc                   (Icecast, ACAO:*)
 *   WRCT   https://streamalt.wrct.org/wrct-hi.mp3         (Cloudflare, ACAO:*)
 *   WXDU   https://weeping.wxdu.duke.edu:8443/wxdu128.mp3 (Icecast port 8443, no ACAO —
 *          irrelevant: ACAO is not required for plain <audio src> playback)
 *   WICB   https://icecast.do.zufall.co/wicb_mp3_high     (kh15 Icecast, ACAO reflect)
 */

import { test, expect } from "@playwright/test";

const STREAMS = [
  {
    station: "WHPK",
    url: "https://whpk-stream.uchicago.edu/stream",
    note: "Icecast ACAO:*",
  },
  {
    station: "WZBC",
    url: "https://stream.wzbc.org/wzbc",
    note: "Icecast ACAO:*",
  },
  {
    station: "WRCT",
    url: "https://streamalt.wrct.org/wrct-hi.mp3",
    note: "Cloudflare proxy ACAO:*",
  },
  {
    station: "WXDU",
    url: "https://weeping.wxdu.duke.edu:8443/wxdu128.mp3",
    note: "Icecast port 8443, no ACAO (irrelevant for <audio>)",
  },
  {
    station: "WICB",
    url: "https://icecast.do.zufall.co/wicb_mp3_high",
    note: "kh15 Icecast origin-reflection",
  },
] as const;

// 20 seconds: enough for a healthy stream to decode its first audio frame
// and fire `playing`, even on a slow connection.
const TIMEOUT_MS = 20_000;

// Use HTTPS Replit domain when available so Chromium enforces mixed-content
// policy (HTTPS document → HTTP resource is blocked). Falls back to the HTTP
// dev server for local development use — network-layer and playback-layer
// checks remain active.
const PAGE_ORIGIN = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : (process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:80");

for (const { station, url, note } of STREAMS) {
  test(`${station} stream plays from ${PAGE_ORIGIN.startsWith("https") ? "HTTPS" : "HTTP"} Lore origin without mixed-content errors (${note})`, async ({
    page,
  }) => {
    // ── 1. Network-layer: capture all requests to the stream host ──────────
    // Playwright hooks into Chromium's network layer and sees every request,
    // including redirects, before the response body arrives. We record the URL
    // of every request to the target host to assert the chain stays HTTPS.
    const streamHost = new URL(url).host;
    const capturedRequestUrls: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes(streamHost)) {
        capturedRequestUrls.push(request.url());
      }
    });

    // ── 2. Origin layer: navigate to the Lore app (HTTPS when possible) ───
    // HTTPS document origin makes Chromium enforce mixed-content blocking:
    // any HTTP redirect from an HTTPS audio src would block the load.
    await page.goto(`${PAGE_ORIGIN}/lore/`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // ── 3. Playback layer: muted play() → assert `playing` event ──────────
    type AudioResult =
      | {
          status: "playing";
          currentSrc: string;
          paused: boolean;
        }
      | { status: "error"; code: number | null; message: string | null }
      | { status: "timeout"; networkState: number; readyState: number };

    const result: AudioResult = await page.evaluate(
      async ({ streamUrl, timeoutMs }) => {
        return new Promise<AudioResult>((resolve) => {
          const audio = new Audio();
          // Muted so Chromium permits autoplay without a user gesture.
          // The full media pipeline (network load → decode → play) still runs;
          // only the speaker output is suppressed.
          audio.muted = true;
          audio.preload = "auto";

          const timer = setTimeout(() => {
            audio.pause();
            audio.src = "";
            resolve({
              status: "timeout",
              networkState: audio.networkState,
              readyState: audio.readyState,
            });
          }, timeoutMs);

          // `playing` fires when the browser has decoded enough data to begin
          // advancing currentTime — the strongest reliable signal that the full
          // media pipeline (network → demux → decode) is working.
          audio.addEventListener("playing", () => {
            const currentSrc = audio.currentSrc;
            const paused = audio.paused;
            clearTimeout(timer);
            audio.pause();
            audio.src = "";
            resolve({ status: "playing", currentSrc, paused });
          });

          audio.addEventListener("error", () => {
            clearTimeout(timer);
            audio.src = "";
            resolve({
              status: "error",
              code: audio.error?.code ?? null,
              message: audio.error?.message ?? null,
            });
          });

          audio.src = streamUrl;
          // play() returns a Promise; rejection (e.g. NotAllowedError on
          // unmuted autoplay) is surfaced via the catch handler.
          audio.play().catch((err: unknown) => {
            clearTimeout(timer);
            audio.src = "";
            resolve({
              status: "error",
              code: null,
              message: err instanceof Error ? err.message : String(err),
            });
          });
        });
      },
      { streamUrl: url, timeoutMs: TIMEOUT_MS },
    );

    // ── Assertions ──────────────────────────────────────────────────────────

    // Playback assertion: `playing` must have fired.
    expect(
      result.status,
      `${station}: expected "playing"; got: ${JSON.stringify(result)}`,
    ).toBe("playing");

    if (result.status === "playing") {
      // currentSrc assertion: the URL the browser actually resolved to must
      // remain HTTPS — not a redirect-escaped HTTP URL.
      expect(
        result.currentSrc,
        `${station}: currentSrc must be HTTPS after load (was: ${result.currentSrc})`,
      ).toMatch(/^https:\/\//);
    }

    // Network-layer assertion: every request Playwright saw to this stream
    // host must have been HTTPS. This catches HTTP redirects even before they
    // reach the audio element or cause a mixed-content block.
    expect(
      capturedRequestUrls.length,
      `${station}: expected ≥1 captured network request to ${streamHost}; got 0`,
    ).toBeGreaterThan(0);

    for (const reqUrl of capturedRequestUrls) {
      expect(
        reqUrl,
        `${station}: network request to stream host must be HTTPS (got: ${reqUrl})`,
      ).toMatch(/^https:\/\//);
    }
  });
}
