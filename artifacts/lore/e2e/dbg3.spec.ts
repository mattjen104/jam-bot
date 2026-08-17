import { test, expect } from "@playwright/test";
const DOCK_SLUGS = ["nts-1","kcrw","bbc6","wfmu","kexp","soma","fip1","nts-2"];
const DOCK_STATIONS = DOCK_SLUGS.map((slug, idx) => ({
  id: idx+1, slug, name:`Station ${slug.toUpperCase()}`, org:slug.toUpperCase(), city:"London", country:"GB",
  streamUrl:`https://stream.example.test/lore-e2e-${slug}`, streamQuality:null, streamFormat:"aac", mode:"live",
  homepageUrl:`https://${slug}.example.test`, donateUrl:null, logoUrl:null, attribution:true, tags:null,
  mayHaveAds:false, votes:0, clickcount:0, upcomingShowCount:0,
}));
function makeNP(slug: string, idx: number) { return { spinId:900+idx, rawArtist:`Artist ${idx+1}`, rawTitle:`Track ${idx+1}`, source:"nts_live", confidence:"unresolved", playedAt:new Date(Date.now()-idx*60_000).toISOString(), artworkUrl:null, recording:null, show:{name:`Show ${idx+1}`,djName:`DJ ${idx+1}`}, isFirstSpin:false, isLibraryHit:true, isArtistHit:true }; }
function makeSched() { const n=Date.now(); return { items: DOCK_SLUGS.map((slug,idx)=>({ stationSlug:slug, runs:[{ runId:idx+1, show:{name:`Show ${idx+1}`,djName:`DJ ${idx+1}`,pickerId:null}, spinCount:10, resolvedCount:0, startedAt:new Date(n-2*3600_000).toISOString(), endedAt:new Date(n+3600_000).toISOString() }] }))}; }
function makeCross() { return { items: DOCK_SLUGS.map((slug,idx)=>({ stationSlug:slug, crossings:3+idx, artistCrossings:2, weekCrossings:5+idx, weekArtistCrossings:3, monthCrossings:10+idx, monthArtistCrossings:6, lifetimeCrossings:20+idx, lifetimeArtistCrossings:12, topArtistNames:[`Artist ${idx+1}`] }))}; }
async function installRoutes(page: import("@playwright/test").Page) {
  await page.route("https://stream.example.test/**", r => r.abort());
  await page.route("**/api/me/connections", r => r.fulfill({json:{connections:[]}}));
  await page.route("**/api/me/crossings**", r => r.fulfill({json:makeCross()}));
  await page.route("**/api/me/picker-names", r => r.fulfill({json:{names:["Artist 1","Artist 2"],hasLibrary:true,hasSeeds:true}}));
  await page.route("**/api/me/pickers/overlap**", r => r.fulfill({json:{items:[]}}));
  await page.route("**/api/me/album-avatar**", r => r.fulfill({json:{candidates:[],needsChoice:false}}));
  await page.route("**/api/me/**", r => r.fulfill({status:404,json:{error:"Not found"}}));
  await page.route("**/api/stations", r => r.fulfill({json:{stations:DOCK_STATIONS}}));
  await page.route("**/api/stations/now-playing", r => r.fulfill({json:{items:DOCK_SLUGS.map((s,i)=>({slug:s,nowPlaying:makeNP(s,i)}))}}));
  await page.route("**/api/stations/now-playing/stream", r => r.fulfill({status:200,headers:{"content-type":"text/event-stream"},body:": ok\n\n"}));
  for(const[i,s] of DOCK_SLUGS.entries()) await page.route(`**/api/stations/${s}/now-playing`, r=>r.fulfill({json:{station:DOCK_STATIONS[i],nowPlaying:makeNP(s,i)}}));
  await page.route("**/api/stations/schedule**", r => r.fulfill({json:makeSched()}));
  await page.route("**/api/stations/recent-spins**", r => r.fulfill({json:{items:[]}}));
  await page.route("**/api/stations/artist-frequency**", r => r.fulfill({json:{items:[]}}));
  await page.route("**/api/pickers/**", r => r.fulfill({json:{items:[]}}));
}
test.beforeEach(async({page}) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("lore:first-run-prompted","1"); } catch {} });
});
test("without fake ES, mobile viewport → fdrow count", async ({ page }) => {
  await installRoutes(page);
  await page.setViewportSize({width:390,height:844});
  const errors: string[] = [];
  page.on("response", r => { if(r.status()>=400 && r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto("/lore/");
  await page.waitForTimeout(8000);
  const n = await page.locator(".fdrow").count();
  console.log("fdrows:", n, "api-errors:", errors.slice(0,5));
  expect(n).toBeGreaterThan(0);
});
test("with fake ES, mobile viewport → fdrow count", async ({ page }) => {
  await page.addInitScript(() => {
    const all: any[] = [];
    class FES { static OPEN=1; url:string; readyState=1; onopen:any=null; onmessage:any=null; onerror:any=null;
      constructor(url:string){this.url=url;all.push(this);(window as any).__fakeEsAll=all;Promise.resolve().then(()=>{if(this.onopen)this.onopen(new Event("open"));})}
      close(){this.readyState=2;} _dispatch(d:string){if(this.onmessage)this.onmessage(new MessageEvent("message",{data:d}));}
    }
    (window as any).EventSource=FES;
    (window as any).__dispatchToAll=(d:string)=>{for(const es of all)(es as any)._dispatch(d);};
  });
  await installRoutes(page);
  await page.setViewportSize({width:390,height:844});
  const errors: string[] = [];
  page.on("response", r => { if(r.status()>=400 && r.url().includes("/api/")) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto("/lore/");
  await page.waitForTimeout(8000);
  const n = await page.locator(".fdrow").count();
  console.log("fdrows:", n, "api-errors:", errors.slice(0,5));
  expect(n).toBeGreaterThan(0);
});
