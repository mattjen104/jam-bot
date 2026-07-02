import { Switch, Route, Router as WouterRouter } from "wouter";
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
import { PlayerProvider } from "./player/PlayerProvider";
import { PlayerDock } from "./components/PlayerDock";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/song/:mbid" component={Song} />
      <Route path="/archive" component={Archive} />
      <Route path="/archive/stations/:slug" component={StationArchive} />
      <Route path="/archive/station-runs/:runId" component={StationRun} />
      <Route path="/archive/pickers/:handle" component={PickerArchive} />
      <Route path="/archive/picker-runs/:runId" component={PickerRun} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PlayerProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <PlayerDock />
          <Toaster />
        </PlayerProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
