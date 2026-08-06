/**
 * ConnectionCentre — in-player panel showing which playback services are
 * available, connected, and how to connect more.
 *
 * Three tiers of service cards:
 *   1. Automatic (YouTube) — always active, no account needed
 *   2. Connect your account — Spotify, Apple Music
 *   3. Your files — local folder, Bandcamp (embed info)
 *
 * Cards reflect live state: connected services show "Connected ✓" with a
 * disconnect option. No account is required to close the panel.
 */

import { useCallback, useState } from "react";
import {
  CheckCircle2,
  FolderOpen,
  Headphones,
  Music2,
  ShoppingBag,
  X,
  Youtube,
  Zap,
} from "lucide-react";
import type { SpotifyConnectApi } from "./useSpotifyConnect";
import type { LocalFileDriverExtras } from "./useLocalFileDriver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionCentreProps {
  open: boolean;
  onClose: () => void;

  // Service state
  spotify: SpotifyConnectApi;
  appleMusicConfigured: boolean;
  appleMusicConnected: boolean;
  onConnectAppleMusic: () => void;

  // Local files
  localFiles: LocalFileDriverExtras;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 pb-1 font-mono text-[12px] uppercase tracking-widest text-muted-foreground/60">
      {children}
    </p>
  );
}

interface ServiceCardProps {
  icon: React.ReactNode;
  name: string;
  benefit: string;
  status: "active" | "connected" | "available" | "not-configured";
  onAction?: () => void;
  actionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryLabel?: string;
  disabled?: boolean;
}

function ServiceCard({
  icon,
  name,
  benefit,
  status,
  onAction,
  actionLabel,
  onSecondaryAction,
  secondaryLabel,
  disabled,
}: ServiceCardProps) {
  const statusBadge: Record<string, React.ReactNode> = {
    active: (
      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-zinc-400">
        <CheckCircle2 className="h-3 w-3" />
        Active
      </span>
    ),
    connected: (
      <span className="inline-flex items-center gap-1 font-mono text-[13px] text-zinc-400">
        <CheckCircle2 className="h-3 w-3" />
        Connected
      </span>
    ),
    available: null,
    "not-configured": (
      <span className="font-mono text-[13px] text-muted-foreground/50">
        Unavailable
      </span>
    ),
  };

  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-background/50 p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[15px] font-normal text-foreground">
            {name}
          </span>
          {statusBadge[status]}
        </div>
        <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">
          {benefit}
        </p>
        {(onAction || onSecondaryAction) && (
          <div className="mt-2 flex items-center gap-2">
            {onAction && actionLabel && (
              <button
                type="button"
                onClick={onAction}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[13px] text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
              >
                {actionLabel}
              </button>
            )}
            {onSecondaryAction && secondaryLabel && (
              <button
                type="button"
                onClick={onSecondaryAction}
                className="font-mono text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {secondaryLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConnectionCentre({
  open,
  onClose,
  spotify,
  appleMusicConfigured,
  appleMusicConnected,
  onConnectAppleMusic,
  localFiles,
}: ConnectionCentreProps) {
  const handleSpotifyConnect = useCallback(() => {
    spotify.connect();
  }, [spotify]);

  const handleSpotifyDisconnect = useCallback(() => {
    spotify.disconnect();
  }, [spotify]);

  const handleBrowseFiles = useCallback(() => {
    void localFiles.browse();
  }, [localFiles]);

  const handleClearFiles = useCallback(() => {
    localFiles.clearFiles();
  }, [localFiles]);

  // Apple Music authorization state.
  const [amConnecting, setAmConnecting] = useState(false);
  const [amAuthError, setAmAuthError] = useState<string | null>(null);

  /**
   * Trigger MusicKit authorization.  Uses the globally-loaded MusicKit JS
   * (the Apple Music driver bootstraps it on first play).  If MusicKit hasn't
   * been configured/loaded yet, shows an actionable message.
   */
  const handleAppleMusicConnect = useCallback(async () => {
    setAmConnecting(true);
    setAmAuthError(null);
    try {
      // MusicKit JS is loaded and initialized by the Apple Music driver when
      // the developer token is configured.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mk = (window as any).MusicKit as
        | { getInstance?: () => { authorize?: () => Promise<unknown> } }
        | undefined;
      const instance = mk?.getInstance?.();
      if (!instance?.authorize) {
        throw new Error(
          "Apple Music hasn't loaded yet — try playing a track first to initialize it.",
        );
      }
      await instance.authorize();
      // Authorization succeeded — notify PlayerProvider so it marks Apple Music
      // as connected (the prop updates asynchronously on the next render).
      onConnectAppleMusic();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Authorization failed — please try again.";
      setAmAuthError(msg);
    } finally {
      setAmConnecting(false);
    }
  }, [onConnectAppleMusic]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Connection Centre"
        className="fixed bottom-[68px] left-4 right-4 z-50 max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-secondary/98 shadow-2xl backdrop-blur-md lg:left-auto lg:right-6 lg:w-[420px]"
        data-testid="connection-centre"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div>
            <h2 className="font-mono text-base font-normal text-foreground">
              Connection Centre
            </h2>
            <p className="mt-0.5 font-mono text-[13px] text-muted-foreground">
              Choose how Lore plays music for you
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* ── Tier 1: Automatic ── */}
          <div>
            <SectionLabel>Automatic · No account needed</SectionLabel>
            <div className="space-y-2">
              <ServiceCard
                icon={<Youtube className="h-4 w-4" />}
                name="YouTube"
                benefit="Always on · Full tracks · No sign-in"
                status="active"
              />
            </div>
          </div>

          {/* ── Tier 2: Connect your account ── */}
          <div>
            <SectionLabel>Connect your account · Full quality</SectionLabel>
            <div className="space-y-2">
              {/* Spotify */}
              {spotify.configured ? (
                <ServiceCard
                  icon={<Headphones className="h-4 w-4" />}
                  name="Spotify"
                  benefit={
                    spotify.connected && spotify.displayName
                      ? `Signed in as ${spotify.displayName} · Loads your library · Media key control`
                      : "Loads your library · Full quality · Media key control"
                  }
                  status={spotify.connected ? "connected" : "available"}
                  onAction={spotify.connected ? undefined : handleSpotifyConnect}
                  actionLabel={spotify.connected ? undefined : "Connect"}
                  onSecondaryAction={spotify.connected ? handleSpotifyDisconnect : undefined}
                  secondaryLabel={spotify.connected ? "Disconnect" : undefined}
                />
              ) : (
                <ServiceCard
                  icon={<Headphones className="h-4 w-4" />}
                  name="Spotify"
                  benefit="Not configured on this server"
                  status="not-configured"
                />
              )}

              {/* Apple Music */}
              {appleMusicConfigured ? (
                <>
                  <ServiceCard
                    icon={<Music2 className="h-4 w-4" />}
                    name="Apple Music"
                    benefit={
                      appleMusicConnected
                        ? "Authorized · Loads your library · Full quality"
                        : amConnecting
                        ? "Authorizing…"
                        : "Loads your library · Full quality · Media key control"
                    }
                    status={appleMusicConnected ? "connected" : "available"}
                    onAction={appleMusicConnected ? undefined : () => void handleAppleMusicConnect()}
                    actionLabel={
                      appleMusicConnected
                        ? undefined
                        : amConnecting
                        ? "Connecting…"
                        : "Connect"
                    }
                    disabled={amConnecting}
                  />
                  {amAuthError && (
                    <p className="font-mono text-[13px] text-zinc-400 pl-1">
                      {amAuthError}
                    </p>
                  )}
                </>
              ) : (
                <ServiceCard
                  icon={<Music2 className="h-4 w-4" />}
                  name="Apple Music"
                  benefit="Not configured on this server"
                  status="not-configured"
                />
              )}
            </div>
          </div>

          {/* ── Tier 3: Your files ── */}
          <div>
            <SectionLabel>Your files · Play what you own</SectionLabel>
            <div className="space-y-2">
              {/* Local folder */}
              <ServiceCard
                icon={<FolderOpen className="h-4 w-4" />}
                name="Local folder"
                benefit={
                  localFiles.hasDirectory
                    ? `${localFiles.matchCount} track${localFiles.matchCount !== 1 ? "s" : ""} matched · Play files you own`
                    : "Browse a folder of mp3/flac/m4a files · No streaming needed"
                }
                status={localFiles.hasDirectory ? "connected" : "available"}
                onAction={localFiles.scanning ? undefined : handleBrowseFiles}
                actionLabel={
                  localFiles.scanning
                    ? "Scanning…"
                    : localFiles.hasDirectory
                    ? "Re-scan folder"
                    : "Browse folder"
                }
                onSecondaryAction={localFiles.hasDirectory ? handleClearFiles : undefined}
                secondaryLabel={localFiles.hasDirectory ? "Clear" : undefined}
                disabled={localFiles.scanning}
              />

              {/* Bandcamp */}
              <ServiceCard
                icon={<ShoppingBag className="h-4 w-4" />}
                name="Bandcamp"
                benefit="When a track has a Bandcamp release, Lore plays it via the embed player automatically · No sign-in needed"
                status="active"
              />
            </div>
          </div>

          {/* Info footer */}
          <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
            <div className="flex items-start gap-2">
              <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <p className="font-mono text-[13px] text-muted-foreground">
                Lore tries each service in order: Local files → Spotify → Apple Music →
                Bandcamp → YouTube. You always hear audio; higher services just
                mean better quality and your own library.
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
