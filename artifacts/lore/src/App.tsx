import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Song from "@/pages/Song";
import Artist from "@/pages/Artist";
import Album from "@/pages/Album";
import Archive from "@/pages/Archive";
import StationArchive from "@/pages/StationArchive";
import StationRun from "@/pages/StationRun";
import SelectorArchive from "@/pages/SelectorArchive";
import SelectorRun from "@/pages/SelectorRun";
import Selectors from "@/pages/Selectors";
import Journal from "@/pages/Journal";
import Following from "@/pages/Following";
import Library from "@/pages/Library";
import TasteMap from "@/pages/TasteMap";
import AdminClaims from "@/pages/AdminClaims";
import AdminSongExploder from "@/pages/AdminSongExploder";
import AdminSelectors from "@/pages/AdminSelectors";
import AdminRadioBrowser from "@/pages/AdminRadioBrowser";
import AdminStations from "@/pages/AdminStations";
import AdminListCandidates from "@/pages/AdminListCandidates";
import AdminCriCandidates from "@/pages/AdminCriCandidates";
import AdminHealth from "@/pages/AdminHealth";
import DjPage from "@/pages/DjPage";
import ScheduleCalendar from "@/pages/ScheduleCalendar";
import WebPlayer from "./webplayer/WebPlayer";
import { PlayerProvider } from "./player/PlayerProvider";
import { PlayerDock } from "./components/PlayerDock";
import { ListeningLogger } from "./components/ListeningLogger";
import { AppLayout } from "./components/AppLayout";
import { prefersClassic } from "./lib/uiPrefs";

const queryClient = new QueryClient();

/**
 * After the Spotify library connect callback, the server redirects to
 * /lore/?library=connected. We catch that here and forward to /taste-map.
 * This runs inside the Router so wouter's base is already applied.
 */
function LibraryConnectRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lib = params.get("library");
    if (lib === "connected") {
      // Strip the param and navigate to the taste-map (auto-import on arrival)
      const newSearch = new URLSearchParams(params);
      newSearch.delete("library");
      setLocation(`/taste-map?import=1`);
    }
  }, [setLocation]);
  return null;
}

/** Only redirect once per full page load, not on every in-app navigation. */
let didInitialMobileRoute = false;

/**
 * Mobile-first default: on phone-sized screens, an initial visit to the
 * classic home (/) lands on the webplayer (/player) instead. Opt-outs:
 * - the user tapped "CLASSIC SITE" in the webplayer this session, or
 * - they deep-linked to any non-home classic page.
 */
function MobileDefaultRedirect() {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (didInitialMobileRoute) return;
    didInitialMobileRoute = true;
    const path = location.split("?")[0] ?? location;
    if (path !== "/" && path !== "") return;
    // OAuth callbacks land on / with a ?library= or ?spotify= param and must
    // be handled by their own effects before we strip the URL via redirect.
    const cbParams = new URLSearchParams(window.location.search);
    if (cbParams.get("library") === "connected") return;
    if (cbParams.has("spotify")) return;
    if (prefersClassic()) return;
    if (window.matchMedia("(max-width: 767px)").matches) {
      setLocation("/player", { replace: true });
    }
  }, [location, setLocation]);
  return null;
}

function Router() {
  return (
    <>
      <LibraryConnectRedirect />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/song/:mbid" component={Song} />
        <Route path="/artist/:mbid" component={Artist} />
        <Route path="/album/:releaseGroupMbid" component={Album} />
        <Route path="/archive" component={Archive} />
        <Route path="/archive/stations/:slug" component={StationArchive} />
        <Route path="/archive/station-runs/:runId" component={StationRun} />
        {/* Canonical selector routes */}
        <Route path="/selectors" component={Selectors} />
        <Route path="/archive/selectors/:handle" component={SelectorArchive} />
        <Route path="/archive/selector-runs/:runId" component={SelectorRun} />
        {/* Legacy picker routes — redirect to canonical selector paths */}
        <Route path="/archive/pickers/:handle">
          {(params) => <Redirect to={`/archive/selectors/${params.handle}`} />}
        </Route>
        <Route path="/archive/picker-runs/:runId">
          {(params) => <Redirect to={`/archive/selector-runs/${params.runId}`} />}
        </Route>
        <Route path="/journal" component={Journal} />
        <Route path="/following" component={Following} />
        <Route path="/library" component={Library} />
        <Route path="/taste-map" component={TasteMap} />
        <Route path="/admin" component={AdminClaims} />
        <Route path="/admin/song-exploder" component={AdminSongExploder} />
        <Route path="/admin/selectors" component={AdminSelectors} />
        <Route path="/admin/radio-browser" component={AdminRadioBrowser} />
        <Route path="/admin/stations" component={AdminStations} />
        <Route path="/admin/list-candidates" component={AdminListCandidates} />
        <Route path="/admin/cri" component={AdminCriCandidates} />
        <Route path="/admin/health" component={AdminHealth} />
        {/* /stations is the Radio sub-nav entry — shows the full station directory */}
        <Route path="/stations" component={Archive} />
        <Route path="/dj/:name" component={DjPage} />
        <Route path="/schedule" component={ScheduleCalendar} />
        {/* Legacy admin route */}
        <Route path="/admin/pickers">
          {() => <Redirect to="/admin/selectors" />}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

/**
 * The webplayer (/player) is a standalone parallel surface: no AppLayout
 * chrome and no PlayerDock (it renders its own now-playing card). Everything
 * else gets the classic shell.
 */
function Shell() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const isWebplayer = path === "/player" || path.startsWith("/player/");

  if (isWebplayer) {
    return (
      <Switch>
        <Route path="/player" component={WebPlayer} />
        <Route path="/player/:tab" component={WebPlayer} />
        <Route component={WebPlayer} />
      </Switch>
    );
  }

  return (
    <>
      <MobileDefaultRedirect />
      <AppLayout>
        <Router />
      </AppLayout>
      <PlayerDock />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PlayerProvider>
          <ListeningLogger />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Shell />
          </WouterRouter>
          <Toaster />
        </PlayerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
