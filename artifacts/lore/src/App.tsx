import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect, useState } from "react";
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
import { RecordPeekNav } from "./components/RecordPeekNav";
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

/** Full-width artist-add strip — sits above the nav tabs on the Radio section.
 *  Submits artists via the same "lore:add-ticker-artist" custom event that
 *  DialView already listens to, so no shared state is needed. */
function ArtistAddStrip() {
  const [addMode, setAddMode] = useState(false);
  const [text, setText] = useState("");

  function submitText(raw: string) {
    const names = raw.split(/[\n,;|•·]+/).map((s) => s.trim()).filter(Boolean);
    names.forEach((name) =>
      window.dispatchEvent(new CustomEvent("lore:add-ticker-artist", { detail: name })),
    );
    setText("");
    setAddMode(false);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const t = e.clipboardData.getData("text");
    if (t) { e.preventDefault(); submitText(t); }
  }

  return (
    <div className="artist-add-strip">
      <button
        type="button"
        className={`topbar-add-artists${addMode ? " topbar-add-artists--active" : ""}`}
        onClick={() => setAddMode((m) => !m)}
      >
        ＋ artists
      </button>
      {!addMode ? (
        <input
          type="text"
          className="topbar-paste-box artist-add-strip__input"
          value={text}
          placeholder="paste artist names or a screenshot…"
          aria-label="Add artists by pasting names or a screenshot"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && text.trim()) submitText(text);
            if (e.key === "Escape") setText("");
          }}
          onPaste={handlePaste}
        />
      ) : (
        <div className="topbar-artist-input-wrap artist-add-strip__input">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            type="text"
            className="topbar-artist-input"
            value={text}
            placeholder="type or paste an artist name…"
            aria-label="Add an artist"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) submitText(text);
              if (e.key === "Escape") { setAddMode(false); setText(""); }
            }}
            onPaste={handlePaste}
          />
          <button
            type="button"
            className="topbar-artist-input__esc"
            onClick={() => { setAddMode(false); setText(""); }}
            aria-label="Close"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** Unified fixed bottom shell — player dock sits directly above the nav tabs.
 *  On the Radio section, the artist-add strip sits above the shell border. */
function BottomShell() {
  const [location] = useLocation();
  const path = location.split("?")[0] ?? location;
  const isRadio = path === "/";
  return (
    <div className="bottom-shell-wrap">
      {isRadio && <ArtistAddStrip />}
      <div className="bottom-shell">
        <PlayerDock />
        <RecordPeekNav />
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
