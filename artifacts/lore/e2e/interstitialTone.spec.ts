import { test, expect } from "@playwright/test";

/**
 * Confirm the live→past crossing tone actually sounds in a real browser
 * despite autoplay rules.
 *
 * The crossing interstitial plays the bundled Lore tone via a *fresh*
 * `new Audio(url).play()` inside a React effect that fires only after a user
 * gesture (the listener triggered the crossing) and an async device check.
 * jsdom can't answer whether real autoplay policy blocks that, so this spec
 * reproduces the exact pattern in Chromium with the strict
 * `--autoplay-policy=user-gesture-required` policy in force — *stricter* than
 * real-world Chrome's default (which also consults the Media Engagement Index
 * and unlocks audible autoplay once the user has interacted with the domain).
 *
 * Findings (Chromium 138, strict policy):
 *  - No gesture at all → play() rejects with NotAllowedError (control).
 *  - Real click, then fresh Audio().play() up to ~5s later → PLAYS. The
 *    governing mechanism under the strict flag is *transient* user
 *    activation (~5s window), which comfortably covers the app's real
 *    gesture→device-check→tone gap.
 *  - Real click, fresh Audio() >5s later → blocked under the strict flag
 *    (sticky activation alone is not enough there), while an audio element
 *    *pre-unlocked inside the gesture handler* still plays. Under default
 *    Chrome policy sticky activation suffices, so this only bites in the
 *    strict-policy + slow-device-check corner.
 *
 * Decision: keep the fresh Audio() + fail-open dismiss. The tone sounds in
 * the realistic path; the only silent-skip corner (strict policy AND a >5s
 * device check) is already handled gracefully by the fail-open, and routing
 * the tone through the ride-shared audio element would risk src races with
 * ride playback for marginal gain.
 *
 * Three harness confounds had to be neutralised (each silently makes autoplay
 * always-allowed and would turn the positive test into a tautology):
 *  - Playwright's default Chromium switches include
 *    `--autoplay-policy=no-user-gesture-required` → stripped via
 *    `ignoreDefaultArgs` (a later duplicate flag wins in Chromium).
 *  - Playwright adds `--mute-audio`; Chromium always allows *inaudible*
 *    playback → stripped too.
 *  - `page.evaluate` runs with CDP `userGesture: true`, granting transient
 *    activation to anything it executes → all playback attempts here run
 *    from `addInitScript` page scripts / deferred setTimeout callbacks, and
 *    evaluate is only used to arm or read results.
 */

test.use({
  launchOptions: {
    ignoreDefaultArgs: [
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
    args: ["--autoplay-policy=user-gesture-required"],
    // Use the system Chromium (no downloaded Playwright browsers in this env).
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : process.env.NIX_CHROMIUM_PATH
        ? { executablePath: process.env.NIX_CHROMIUM_PATH }
        : {}),
  },
});

// The real bundled tone, served by the Vite dev server.
const TONE_PATH = "/lore/src/assets/interstitial-tone.wav";

type ToneAttempt = {
  played: boolean;
  errorName: string | null;
  progressed: boolean;
  endedFired: boolean;
  hadStickyActivation: boolean;
};

declare global {
  interface Window {
    __toneControl?: Promise<ToneAttempt>;
    __armToneAttempt?: (delayMs: number) => void;
    __toneAttempt?: ToneAttempt | null;
  }
}

/** Install the deferred fresh-Audio() attempt helper as a page script. */
async function installAttemptHelper(page: import("@playwright/test").Page) {
  await page.addInitScript((tonePath: string) => {
    window.__toneAttempt = null;
    window.__armToneAttempt = (delayMs: number) => {
      setTimeout(async () => {
        const hadStickyActivation = navigator.userActivation?.hasBeenActive ?? false;
        const tone = new Audio(tonePath);
        const ended = new Promise<boolean>((resolve) => {
          tone.addEventListener("ended", () => resolve(true));
          // Asset is 1.2s; if `ended` never fires something is wrong.
          setTimeout(() => resolve(false), 5000);
        });
        try {
          await tone.play();
        } catch (err) {
          window.__toneAttempt = {
            played: false,
            errorName: (err as DOMException).name,
            progressed: false,
            endedFired: false,
            hadStickyActivation,
          };
          return;
        }
        await new Promise((r) => setTimeout(r, 300));
        const progressed = tone.currentTime > 0;
        const endedFired = await ended;
        window.__toneAttempt = {
          played: true,
          errorName: null,
          progressed,
          endedFired,
          hadStickyActivation,
        };
      }, delayMs);
    };
  }, TONE_PATH);
}

test.describe("crossing interstitial tone vs autoplay policy", () => {
  test("control: play() is blocked without any user gesture", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Attempt playback from a page script at load time — no CDP user gesture,
    // no interaction, so autoplay policy applies exactly as for a real
    // never-touched page.
    await page.addInitScript((tonePath: string) => {
      window.__toneControl = (async (): Promise<ToneAttempt> => {
        await new Promise<void>((r) =>
          window.addEventListener("load", () => r(), { once: true }),
        );
        const hadStickyActivation = navigator.userActivation?.hasBeenActive ?? false;
        const tone = new Audio(tonePath);
        try {
          await tone.play();
          return {
            played: true,
            errorName: null,
            progressed: false,
            endedFired: false,
            hadStickyActivation,
          };
        } catch (err) {
          return {
            played: false,
            errorName: (err as DOMException).name,
            progressed: false,
            endedFired: false,
            hadStickyActivation,
          };
        }
      })();
    }, TONE_PATH);
    await page.goto("/lore/");
    const result = await page.evaluate(() => window.__toneControl!);
    await context.close();
    // The page had never been interacted with…
    expect(result.hadStickyActivation).toBe(false);
    // …so the strict policy must block: if this played, the policy isn't in
    // force in this launch and the positive tests below prove nothing.
    expect(result.played).toBe(false);
    expect(result.errorName).toBe("NotAllowedError");
  });

  test("tone plays after a real click, across a realistic async gap, via a fresh Audio()", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await installAttemptHelper(page);
    await page.goto("/lore/");
    // Genuine user gesture — the crossing always follows one in the app.
    await page.click("body");
    // 3s gap: the realistic order of magnitude for the async device check
    // between the gesture and the tone effect firing (within Chromium's ~5s
    // transient-activation window).
    await page.evaluate(() => window.__armToneAttempt!(3000));
    await page.waitForFunction(() => window.__toneAttempt !== null, undefined, {
      timeout: 20_000,
    });
    const result = (await page.evaluate(() => window.__toneAttempt!)) as ToneAttempt;
    await context.close();
    expect(result.hadStickyActivation).toBe(true);
    expect(result.played).toBe(true);
    expect(result.progressed).toBe(true);
    expect(result.endedFired).toBe(true);
  });

  test("boundary: fresh Audio() >5s after the gesture is blocked under the strict flag (fail-open corner)", async ({
    browser,
  }) => {
    // Documents the one corner where the tone silently skips under the
    // strictest policy: the transient-activation window (~5s) has expired and
    // sticky activation alone is not honoured by `user-gesture-required`.
    // The app already fail-opens here (play() rejection dismisses the gate),
    // so playback never wedges — this test pins the behaviour so a future
    // Chromium change in either direction is noticed.
    const context = await browser.newContext();
    const page = await context.newPage();
    await installAttemptHelper(page);
    await page.goto("/lore/");
    await page.click("body");
    await page.evaluate(() => window.__armToneAttempt!(6000));
    await page.waitForFunction(() => window.__toneAttempt !== null, undefined, {
      timeout: 20_000,
    });
    const result = (await page.evaluate(() => window.__toneAttempt!)) as ToneAttempt;
    await context.close();
    expect(result.hadStickyActivation).toBe(true);
    expect(result.played).toBe(false);
    expect(result.errorName).toBe("NotAllowedError");
  });
});
