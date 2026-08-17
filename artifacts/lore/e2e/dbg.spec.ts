import { test } from "@playwright/test";
const SLUG = "nts-1";
const STATION = {
  id: 1, slug: SLUG, name: "NTS 1", org: "NTS", city: "London", country: "GB",
  streamUrl: "https://stream-relay-geo.ntslive.net/stream",
  streamQuality: null, streamFormat: "aac", mode: "live", tier: "flagship",
  homepageUrl: "https://www.nts.live", donateUrl: null,
  logoUrl: null, attribution: true, tags: null, mayHaveAds: false,
  votes: 0, clickcount: 0, upcomingShowCount: 0,
};
test("debug routes", async ({ page }) => {
  const hits: string[] = [];
  page.on("response", r => { if (r.url().includes("/api/stations")) hits.push(`${r.status()} ${r.url()}`); });
  await page.route("**/api/me/**", r => r.fulfill({ status: 404, json: {} }));
  await page.route("**/api/stations/now-playing/stream", r => r.fulfill({ status:200, headers:{"content-type":"text/event-stream"}, body:": ok\n\n" }));
  await page.route("**/api/stations/now-playing", r => { hits.push("!INTERCEPTED now-playing!"); r.fulfill({ json: { items: [{ slug: SLUG, nowPlaying: { spinId:1, rawArtist:"A", rawTitle:"T", source:"icy", confidence:"text", playedAt: new Date().toISOString(), artworkUrl:null, recording:null, show:null, isFirstSpin:false, isLibraryHit:true, isArtistHit:true } }] } }); });
  await page.route("**/api/stations/**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/stations", r => { hits.push("!INTERCEPTED stations!"); r.fulfill({ json: { stations: [STATION] } }); });
  await page.route("**/api/pickers/**", r => r.fulfill({ json: { items: [] } }));
  await page.route("**/api/player/**", r => r.fulfill({ json: {} }));
  await page.goto("/lore/feed");
  await page.waitForTimeout(5000);
  const fdrows = await page.locator(".fdrow").count();
  console.log("hits:", JSON.stringify(hits));
  console.log("fdrows:", fdrows);
  const txt = (await page.locator("body").innerText()).slice(0, 500);
  console.log("body:", txt);
});
