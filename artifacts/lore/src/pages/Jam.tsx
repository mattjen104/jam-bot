import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft,
  Copy,
  Disc3,
  Link2,
  Loader2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  SkipBack,
  SkipForward,
  Square,
  Users,
} from "lucide-react";
import { usePlayer } from "../player/PlayerProvider";
import { useAppConfig } from "../lib/meHooks";
import { authorizeAppleMusic, type MusicKitInstance } from "../lib/appleMusicReplay";
import {
  JAM_MAX_CORRECTIONS,
  applyJamSnapshot,
  calibrateJamClock,
  correctionAction,
  createAppleJam,
  getAppleJam,
  jamCommand,
  joinAppleJam,
  targetJamPosition,
  type JamQueueEntry,
  type JamSyncStatus,
  type JamView,
} from "../lib/appleMusicJam";

function appleId(links: Array<{ name: string; url: string }>): string | null {
  for (const link of links) {
    if (!/apple/i.test(link.name) && !link.url.includes("music.apple.com")) continue;
    try {
      const url = new URL(link.url);
      const id = url.searchParams.get("i") ?? url.pathname.split("/").filter(Boolean).at(-1);
      if (id && /^\d+$/.test(id)) return id;
    } catch {
      // Ignore malformed service links.
    }
  }
  return null;
}

function statusLabel(status: JamSyncStatus): string {
  switch (status) {
    case "authorization-required": return "Connect Apple Music to listen";
    case "ready": return "Ready";
    case "buffering": return "Buffering";
    case "in-sync": return "In sync";
    case "out-of-sync": return "Out of sync — use resync";
    case "unavailable": return "This recording is unavailable in Apple Music";
    case "reconnecting": return "Reconnecting to the room";
    case "source-offline": return "Record source offline";
    case "ended": return "Jam ended";
  }
}

export default function Jam({ code: routeCode }: { code?: string }) {
  const [, navigate] = useLocation();
  const { ride, radio } = usePlayer();
  const [joinCode, setJoinCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rideQueue = useMemo<JamQueueEntry[]>(() => ride.queue.map((item) => ({
    mbid: item.mbid,
    title: item.title,
    artist: item.artist,
    artworkUrl: item.artworkUrl,
    appleMusicId: appleId(item.links),
    durationMs: item.spinDurationSeconds ? item.spinDurationSeconds * 1000 : null,
  })), [ride.queue]);

  const create = async (mode: "queue" | "record") => {
    setCreating(true);
    setError(null);
    try {
      const jam = await createAppleJam(mode, mode === "queue" ? rideQueue : []);
      ride.stop();
      radio.stop();
      navigate(`/jam/${jam.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the jam.");
    } finally {
      setCreating(false);
    }
  };

  if (routeCode) return <JamRoom code={routeCode.toUpperCase()} />;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-40 pt-10 sm:px-6">
      <Link href="/" className="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Lore
      </Link>
      <p className="mt-10 font-mono text-xs uppercase tracking-[0.32em] text-primary">Private listening room</p>
      <h1 className="mt-3 font-serif text-4xl text-foreground">Listen together on Apple Music</h1>
      <p className="mt-3 max-w-xl text-muted-foreground">
        Every listener authorizes their own subscription. Lore shares only a queue and clock — never Apple credentials or captured audio.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void create("queue")}
          disabled={creating || rideQueue.length === 0}
          className="rounded-2xl border border-card-border bg-card p-5 text-left hover:border-primary/50 disabled:opacity-40"
          data-testid="create-queue-jam"
        >
          <Radio className="h-5 w-5 text-primary" />
          <span className="mt-4 block font-serif text-2xl">Lore queue</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Share the current ride or replay. The host controls play, pause, seek, previous, next, and stop.
          </span>
        </button>
        <button
          type="button"
          onClick={() => void create("record")}
          disabled={creating}
          className="rounded-2xl border border-card-border bg-card p-5 text-left hover:border-primary/50 disabled:opacity-40"
          data-testid="create-record-jam"
        >
          <Disc3 className="h-5 w-5 text-primary" />
          <span className="mt-4 block font-serif text-2xl">Follow a record</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            Pair the desktop helper and let a turntable or line-in become the room clock.
          </span>
        </button>
      </div>
      {rideQueue.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Start a Lore ride or replay first to seed a queue jam.</p>
      ) : null}

      <form
        className="mt-10 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const code = joinCode.trim().toUpperCase();
          if (/^[A-Z2-9]{6}$/.test(code)) navigate(`/jam/${code}`);
          else setError("Enter the six-character room code.");
        }}
      >
        <input
          value={joinCode}
          onChange={(event) => setJoinCode(event.target.value)}
          placeholder="ROOM CODE"
          aria-label="Room code"
          maxLength={6}
          className="min-w-0 flex-1 rounded-xl border border-card-border bg-card px-4 py-3 font-mono uppercase tracking-[0.25em]"
        />
        <button className="rounded-xl border border-primary/50 px-5 font-mono text-sm text-primary" type="submit">Join</button>
      </form>
      {error ? <p className="mt-4 text-sm text-destructive-foreground">{error}</p> : null}
      {creating ? <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Starting room…</p> : null}
    </main>
  );
}

function JamRoom({ code }: { code: string }) {
  const [, navigate] = useLocation();
  const { data: appConfig } = useAppConfig();
  const [view, setView] = useState<JamView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<JamSyncStatus>("authorization-required");
  const [connected, setConnected] = useState(false);
  const [listenLocally, setListenLocally] = useState(true);
  const [serverOffset, setServerOffset] = useState(0);
  const [helper, setHelper] = useState<{ token: string; ingestPath: string; expiresAt: string } | null>(null);
  const musicRef = useRef<MusicKitInstance | null>(null);
  const currentAppleIdRef = useRef<string | null>(null);
  const appliedRevisionRef = useRef(-1);
  const correctionAttemptsRef = useRef(0);
  const hasView = view != null;

  useEffect(() => {
    let cancelled = false;
    void joinAppleJam(code)
      .then((next) => {
        if (!cancelled) {
          setView(next);
          if (next.mode === "record" && next.role === "host") setListenLocally(false);
        }
      })
      .catch(async () => {
        try {
          const next = await getAppleJam(code);
          if (!cancelled) setView(next);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not join this jam.");
        }
      });
    return () => { cancelled = true; };
  }, [code]);

  useEffect(() => {
    if (!hasView) return;
    const stream = new EventSource(`/api/jams/${encodeURIComponent(code)}/events`, { withCredentials: true });
    const update = (event: MessageEvent<string>) => {
      const next = JSON.parse(event.data) as JamView;
      if (next.revision <= appliedRevisionRef.current) return;
      appliedRevisionRef.current = next.revision;
      setView(next);
    };
    ["snapshot", "presence", "transport", "mode", "source", "ended"].forEach((name) => stream.addEventListener(name, update as EventListener));
    stream.onerror = () => setSyncStatus("reconnecting");
    stream.onopen = () => {
      setSyncStatus((current) => current === "reconnecting" ? (connected ? "ready" : "authorization-required") : current);
    };
    return () => stream.close();
  }, [code, connected, hasView]);

  useEffect(() => {
    if (!hasView) return;
    void calibrateJamClock(code).then(setServerOffset).catch(() => setSyncStatus("reconnecting"));
  }, [code, hasView]);

  useEffect(() => {
    const music = musicRef.current;
    if (!view || !connected || !music || !listenLocally || view.revision <= appliedRevisionRef.current - 1) return;
    setSyncStatus("buffering");
    void applyJamSnapshot({
      view,
      music,
      serverOffsetMs: serverOffset,
      currentAppleId: currentAppleIdRef.current,
    }).then((result) => {
      currentAppleIdRef.current = result.currentAppleId;
      correctionAttemptsRef.current = 0;
      setSyncStatus(result.status);
    }).catch(() => setSyncStatus("unavailable"));
  }, [connected, listenLocally, serverOffset, view]);

  useEffect(() => {
    if (!view || !connected || !listenLocally || view.transport.state !== "playing") return;
    const timer = setInterval(() => {
      const music = musicRef.current;
      if (!music || typeof music.currentPlaybackTime !== "number") return;
      const target = targetJamPosition(view, Date.now() + serverOffset);
      const action = correctionAction(music.currentPlaybackTime * 1000, target, correctionAttemptsRef.current);
      if (action === "give-up") {
        setSyncStatus("out-of-sync");
      } else if (action === "seek" && music.seekToTime) {
        correctionAttemptsRef.current += 1;
        void music.seekToTime(target / 1000)
          .then(() => setSyncStatus("in-sync"))
          .catch(() => {
            if (correctionAttemptsRef.current >= JAM_MAX_CORRECTIONS) setSyncStatus("out-of-sync");
          });
      }
    }, 3_000);
    return () => clearInterval(timer);
  }, [connected, listenLocally, serverOffset, view]);

  const connect = useCallback(async () => {
    try {
      if (!appConfig?.appleMusic) throw new Error("Apple Music is not configured for this site.");
      musicRef.current = await authorizeAppleMusic(appConfig.appleMusic);
      setConnected(true);
      setSyncStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Apple Music authorization failed.");
    }
  }, [appConfig]);

  const command = async (path: string, body?: unknown) => {
    try {
      const next = await jamCommand(code, path, body);
      appliedRevisionRef.current = Math.max(appliedRevisionRef.current, next.revision);
      setView(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Room command failed.");
    }
  };

  if (error && !view) {
    return <main className="mx-auto min-h-screen max-w-2xl px-4 pt-16"><p className="rounded-xl border border-destructive-border p-4">{error}</p><Link href="/jam" className="mt-4 inline-block text-primary">Back to jams</Link></main>;
  }
  if (!view) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  const isHost = view.role === "host";
  const sourceOffline = view.mode === "record" && view.source.status === "offline";
  const displayedStatus = sourceOffline ? "source-offline" : view.transport.state === "ended" ? "ended" : syncStatus;
  const inviteUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/jam/${view.code}`;

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 pb-40 pt-8 sm:px-6" data-testid="jam-room">
      <div className="flex items-center justify-between gap-3">
        <Link href="/jam" className="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Jams</Link>
        <span className="inline-flex items-center gap-2 font-mono text-sm text-muted-foreground"><Users className="h-4 w-4" /> {view.members}/{12}</span>
      </div>
      <div className="mt-8 rounded-3xl border border-card-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-primary">{view.mode === "record" ? "Follow a record" : "Lore queue"}</p>
            <h1 className="mt-2 font-serif text-4xl tracking-[0.08em]">{view.code}</h1>
          </div>
          <button type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl)} className="inline-flex items-center gap-2 rounded-full border border-card-border px-4 py-2 font-mono text-sm"><Copy className="h-4 w-4" /> Copy invite</button>
        </div>
        <p className="mt-5 font-mono text-sm" data-testid="jam-sync-status">{statusLabel(displayedStatus)}</p>
        <p className="mt-1 text-sm text-muted-foreground">{isHost ? "You are the host." : "The host controls this room."} Apple authorization stays in this browser.</p>

        {!connected && listenLocally ? (
          <button onClick={() => void connect()} type="button" className="mt-5 rounded-full bg-primary px-5 py-2 font-mono text-sm text-primary-foreground" data-testid="jam-connect-apple">Connect Apple Music</button>
        ) : null}
        {view.mode === "record" && isHost ? (
          <label className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
            <input type="checkbox" checked={listenLocally} onChange={(event) => setListenLocally(event.target.checked)} />
            Also play Apple Music on this device (leave off while listening to vinyl)
          </label>
        ) : null}
      </div>

      <section className="mt-5 rounded-3xl border border-card-border bg-card p-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Now following</p>
        {view.transport.track ? (
          <div className="mt-4 flex items-center gap-4">
            {view.transport.track.artworkUrl ? <img src={view.transport.track.artworkUrl} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-muted"><Disc3 /></div>}
            <div className="min-w-0">
              <p className="truncate font-serif text-2xl">{view.transport.track.title}</p>
              <p className="truncate text-muted-foreground">{view.transport.track.artist}</p>
            </div>
          </div>
        ) : <p className="mt-4 text-muted-foreground">{view.mode === "record" ? "Waiting for a confident fingerprint match." : "This queue has no playable Apple track."}</p>}

        {isHost && view.mode === "queue" ? (
          <div className="mt-6">
            <input
              type="range"
              aria-label="Seek position"
              min={0}
              max={Math.max(1, view.transport.track?.durationMs ?? 300_000)}
              defaultValue={view.transport.positionMs}
              onChange={(event) => void command("/transport", { action: "seek", positionMs: Number(event.target.value) })}
              className="mb-4 w-full accent-primary"
            />
            <div className="flex items-center gap-2">
            <button aria-label="Previous" onClick={() => void command("/transport", { action: "previous" })} className="rounded-full border border-card-border p-3"><SkipBack className="h-4 w-4" /></button>
            {view.transport.state === "playing" ? (
              <button aria-label="Pause" onClick={() => void command("/transport", { action: "pause", positionMs: targetJamPosition(view, Date.now() + serverOffset) })} className="rounded-full bg-primary p-4 text-primary-foreground"><Pause className="h-5 w-5" /></button>
            ) : (
              <button aria-label="Play" onClick={() => void command("/transport", { action: "play" })} className="rounded-full bg-primary p-4 text-primary-foreground"><Play className="h-5 w-5" /></button>
            )}
            <button aria-label="Next" onClick={() => void command("/transport", { action: "next" })} className="rounded-full border border-card-border p-3"><SkipForward className="h-4 w-4" /></button>
            <button aria-label="Stop" onClick={() => void command("/transport", { action: "stop" })} className="rounded-full border border-card-border p-3"><Square className="h-4 w-4" /></button>
            </div>
          </div>
        ) : null}
      </section>

      {view.mode === "record" ? (
        <section className="mt-5 rounded-3xl border border-card-border bg-card p-6">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Record source</p>
          <p className="mt-3 text-sm">{view.source.message ?? "Waiting for the desktop helper."}</p>
          {isHost ? (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void jamCommand(code, "/helper-token").then((value) => setHelper(value as unknown as { token: string; ingestPath: string; expiresAt: string })).catch((err) => setError(String(err)))}
                className="inline-flex items-center gap-2 rounded-full border border-card-border px-4 py-2 font-mono text-sm"
              ><Link2 className="h-4 w-4" /> Pair helper</button>
              <button type="button" onClick={() => void command("/record/resync")} className="inline-flex items-center gap-2 rounded-full border border-card-border px-4 py-2 font-mono text-sm"><RefreshCw className="h-4 w-4" /> Resync</button>
              <button type="button" onClick={() => void command("/record/stop")} className="inline-flex items-center gap-2 rounded-full border border-card-border px-4 py-2 font-mono text-sm"><Square className="h-4 w-4" /> Stop following</button>
            </div>
          ) : null}
          {helper ? (
            <div className="mt-5 rounded-xl bg-muted/40 p-4 font-mono text-xs">
              <p>Run the helper with these one-time room settings:</p>
              <code className="mt-2 block break-all">INGEST_URL={window.location.origin}{helper.ingestPath} JAM_HELPER_TOKEN={helper.token} SOURCE=device npm start</code>
              <p className="mt-2 text-muted-foreground">Choose your line-in, USB turntable, or mic with npm run devices. This credential expires in 30 minutes.</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {isHost ? (
        <section className="mt-5 flex flex-wrap gap-2">
          <button onClick={() => void command("/mode", { mode: view.mode === "record" ? "queue" : "record" })} className="rounded-full border border-card-border px-4 py-2 font-mono text-sm">
            Switch to {view.mode === "record" ? "Lore queue" : "Follow a record"}
          </button>
          <button onClick={() => void command("/leave").then(() => navigate("/jam"))} className="rounded-full border border-destructive-border px-4 py-2 font-mono text-sm">End jam</button>
        </section>
      ) : (
        <button onClick={() => void command("/leave").then(() => navigate("/jam"))} className="mt-5 rounded-full border border-card-border px-4 py-2 font-mono text-sm">Leave jam</button>
      )}
      {error ? <p className="mt-4 text-sm text-destructive-foreground">{error}</p> : null}
    </main>
  );
}
