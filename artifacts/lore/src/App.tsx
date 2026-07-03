import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Song from "@/pages/Song";
import Archive from "@/pages/Archive";
import StationArchive from "@/pages/StationArchive";
import StationRun from "@/pages/StationRun";
import PickerArchive from "@/pages/PickerArchive";
import PickerRun from "@/pages/PickerRun";
import Journal from "@/pages/Journal";
import Following from "@/pages/Following";
import Library from "@/pages/Library";
import TasteMap from "@/pages/TasteMap";
import AdminClaims from "@/pages/AdminClaims";
import { PlayerProvider } from "./player/PlayerProvider";
import { PlayerDock } from "./components/PlayerDock";
import { ListeningLogger } from "./components/ListeningLogger";
import { AppLayout } from "./components/AppLayout";

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

function Router() {
  return (
    <>
      <LibraryConnectRedirect />
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/song/:mbid" component={Song} />
        <Route path="/archive" component={Archive} />
        <Route path="/archive/stations/:slug" component={StationArchive} />
        <Route path="/archive/station-runs/:runId" component={StationRun} />
        <Route path="/archive/pickers/:handle" component={PickerArchive} />
        <Route path="/archive/picker-runs/:runId" component={PickerRun} />
        <Route path="/journal" component={Journal} />
        <Route path="/following" component={Following} />
        <Route path="/library" component={Library} />
        <Route path="/taste-map" component={TasteMap} />
        <Route path="/admin" component={AdminClaims} />
        <Route component={NotFound} />
      </Switch>
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
            <AppLayout>
              <Router />
            </AppLayout>
          </WouterRouter>
          <PlayerDock />
          <Toaster />
        </PlayerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
