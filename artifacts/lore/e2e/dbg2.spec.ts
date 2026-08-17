import { test, expect } from "@playwright/test";
const SLUG = "nts-1";
const STATION = {
  id: 1, slug: SLUG, name: "NTS 1", org: "NTS", city: "London", country: "GB",
  streamUrl: "https://stream-relay-geo.ntslive.net/stream",
  streamQuality: null, streamFormat: "aac", mode: "live",
  homepageUrl: "https://www.nts.live", donateUrl: null,
  logoUrl: null, attribution: true, tags: null, mayHaveAds: false,
  votes: 0, clickcount: 0, upcomingShowCount: 0,
};
const nowPlaying = {
  spinId: 900, rawArtist: "Old Artist", rawTitle: "Old Track",
  source: "icy", confidence: "unresolved", playedAt: new Date().toISOString(),
  artworkUrl: null, recording: null, show: { name: "Test Show", djName: "Test DJ" },
  isFirstSpin: false, isLibraryHit: true, isArtistHit: true,
};
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { sessionStorage.setItem("lore:first-run-prompted", "1"); } catch {}
    (window as any).Audio = class {
      src=""; volume=1; muted=false; paused=true;
      play(){return Promise.resolve();} pause(){} load(){}
      addEventListener(){} removeEventListener(){} dispatchEvent(){return true;}
    };
  });
});
async function installRoutes(page: import("@playwright/test").Page) {
  await page.route("https://stream-relay-geo.ntslive.net/**", r => r.abort());
  await page.route("**/api/me/connections", r => r.fulfill({ json: { connections: [] } }));
  await page.route("**/api/me/crossings**", r => r.fulfill({ json: { items: [{ stationSlug: SLUG, weekCrossings: 2, weekArtistCrossings: 1, monthCrossings: 5, monthArtistCrossings: 2, lifetimeCrossings: 10, lifetimeArtistCrossings: 4, topArtistNames: ["Old Artist"] }] } }));
  await page.route("**/api/me/picker-names", r => r.fulfill({ json: { names: ["Old Artist"], hasLibrary: true, hasSeeds: true } }));
  await page.route("**/api/me/pickers/overlap**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/me/album-avatar**", r => r.fulfill({ json: { candidates: [], needsChoice: false } }));
  await page.route("**/api/me/attendance/heartbeat", r => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/me/presence/heartbeat", r => r.fulfill({ status: 204, body: "" }));
  await page.route("**/api/me/**", r => r.fulfill({ status: 404, json: { error: "Not found" } }));
  await page.route("**/api/stations", r => r.fulfill({ json: { stations: [STATION] } }));
  await page.route("**/api/stations/now-playing", r => r.fulfill({ json: { items: [{ slug: SLUG, nowPlaying }] } }));
  await page.route("**/api/stations/now-playing/stream", r => r.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: ": ok\n\n" }));
  await page.route(`**/api/stations/${SLUG}/now-playing`, r => r.fulfill({ json: { nowPlaying } }));
  await page.route("**/api/stations/schedule**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/stations/recent-spins**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/stations/artist-frequency**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/stations/social/presence**", r => r.fulfill({ json: { presence: {} } }));
  await page.route("**/api/pickers/**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/player/onair", r => r.fulfill({ json: { authenticated: false, items: [] } }));
  await page.route("**/api/player/**", r => r.fulfill({ status: 404, json: {} }));
}
test("without fake EventSource - fdrow appears?", async ({ page }) => {
  await installRoutes(page);
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/lore/");
  await page.waitForTimeout(8000);
  const fdrows = await page.locator(".fdrow").count();
  console.log("fdrows:", fdrows, "errors:", errors.slice(0, 3));
  expect(fdrows).toBeGreaterThanOrEqual(0);
});
test("with fake EventSource - fdrow appears?", async ({ page }) => {
  await page.addInitScript(() => {
    const all: any[] = [];
    class FakeES {
      url: string; readyState=1; onopen: any=null; onerror: any=null; onmessage: any=null;
      constructor(url: string) { this.url = url; all.push(this); (window as any).__fakeEsAll = all; Promise.resolve().then(() => { if (this.onopen) this.onopen(new Event("open")); }); }
      close() { this.readyState = 2; }
      _dispatch(d: string) { if (this.onmessage) this.onmessage(new MessageEvent("message", { data: d })); }
    }
    (window as any).EventSource = FakeES;
    (window as any).__dispatchToAll = (d: string) => { for (const es of all) (es as any)._dispatch(d); };
  });
  await installRoutes(page);
  const errors: string[] = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/lore/");
  await page.waitForTimeout(8000);
  const fdrows = await page.locator(".fdrow").count();
  console.log("fdrows:", fdrows, "errors:", errors.slice(0, 3));
  expect(fdrows).toBeGreaterThanOrEqual(0);
});
