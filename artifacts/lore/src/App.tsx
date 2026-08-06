import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useQueryClient, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import Replay from "@/pages/Replay";
import SelectorArchive from "@/pages/SelectorArchive";
import SelectorRun from "@/pages/SelectorRun";
import Selectors from "@/pages/Selectors";
import Journal from "@/pages/Journal";
import WeeklyRecap from "@/pages/WeeklyRecap";
import Following from "@/pages/Following";
import Library from "@/pages/Library";
import AdminClaims from "@/pages/AdminClaims";
import AdminSongExploder from "@/pages/AdminSongExploder";
import AdminSelectors from "@/pages/AdminSelectors";
import AdminRadioBrowser from "@/pages/AdminRadioBrowser";
import AdminStations from "@/pages/AdminStations";
import AdminListCandidates from "@/pages/AdminListCandidates";
import AdminLists from "@/pages/AdminLists";
import AdminCriCandidates from "@/pages/AdminCriCandidates";
import AdminHealth from "@/pages/AdminHealth";
import AdminSettings from "@/pages/AdminSettings";
import DjPage from "@/pages/DjPage";
import ScheduleCalendar from "@/pages/ScheduleCalendar";
import WebPlayer from "./webplayer/WebPlayer";
import { PlayerProvider } from "./player/PlayerProvider";
import { PlayerDock } from "./components/PlayerDock";
import { SocialModeBar } from "./components/SocialModeBar";
import { ListeningLogger } from "./components/ListeningLogger";
import { AppLayout } from "./components/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { postStartImport, ME_LATEST_IMPORT_JOB_KEY } from "./lib/meHooks";


const queryClient = new QueryClient();

/**
 * After the Spotify library connect callback, the server redirects to
 * /lore/?library=connected. We catch that here, strip the query param,
 * and kick off the import in place — no navigation occurs.
 * This runs inside the Router so wouter's base is already applied.
 */
function LibraryConnectRedirect() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const lib = params.get("library");
    if (lib === "connected") {
      // Strip the param from the URL so refreshing doesn't re-trigger.
      const newSearch = new URLSearchParams(params);
      newSearch.delete("library");
      const qs = newSearch.toString();
      setLocation(window.location.pathname.replace(/^\/lore/, "") + (qs ? `?${qs}` : ""), { replace: true });
      // Start the import immediately; ImportStrip shows progress.
      postStartImport("spotify")
        .catch(() => {
          // 409 (already running) or transient failure — invalidate to re-sync.
        })
        .finally(() => {
          void qc.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function Router() {
  return (
    <>
      <LibraryConnectRedirect />
      <Switch>
        <Route path="/">
          {() => <ErrorBoundary><Home /></ErrorBoundary>}
        </Route>
        <Route path="/song/:mbid" component={Song} />
        <Route path="/artist/:mbid" component={Artist} />
        <Route path="/album/:releaseGroupMbid" component={Album} />
        <Route path="/archive" component={Archive} />
        <Route path="/archive/stations/:slug" component={StationArchive} />
        <Route path="/archive/station-runs/:runId" component={StationRun} />
        <Route path="/replay/:id" component={Replay} />
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
        <Route path="/weekly-recap" component={WeeklyRecap} />
        <Route path="/following" component={Following} />
        <Route path="/library" component={Library} />
        {/* Redirect any deep-linked /taste-map URLs to home */}
        <Route path="/taste-map">
          {() => <Redirect to="/" />}
        </Route>
        <Route path="/admin" component={AdminClaims} />
        <Route path="/admin/song-exploder" component={AdminSongExploder} />
        <Route path="/admin/selectors" component={AdminSelectors} />
        <Route path="/admin/radio-browser" component={AdminRadioBrowser} />
        <Route path="/admin/stations" component={AdminStations} />
        <Route path="/admin/lists" component={AdminLists} />
        <Route path="/admin/list-candidates" component={AdminListCandidates} />
        <Route path="/admin/cri" component={AdminCriCandidates} />
        <Route path="/admin/health" component={AdminHealth} />
        <Route path="/admin/settings" component={AdminSettings} />
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
      <AppLayout>
        <Router />
      </AppLayout>
      <BottomShell />
    </>
  );
}

/** Unified fixed bottom shell — player dock sits directly above the nav tabs.
 *  Its rendered height is measured and published as --shell-h on <html>, so
 *  page padding and the dial's own height always match the real shell size
 *  (covers grow with viewport width, player dock comes and goes). */
function BottomShell() {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () =>
      document.documentElement.style.setProperty("--shell-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--shell-h");
    };
  }, []);
  return (
    <div className="bottom-shell-wrap" ref={wrapRef}>
      <div className="bottom-shell">
        <div className="bottom-shell__strip" aria-hidden="true" />
        <PlayerDock />
        {/* RecordPeekNav (record-sleeve tabs) hidden for now — section nav
            moved into the page space as SlimSectionNav (AppLayout/DialView). */}
      </div>
    </div>
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
