import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListSongExploderEpisodes,
  getListSongExploderEpisodesQueryKey,
  type SongExploderEpisodeListItem,
} from "@workspace/api-client-react";
import { useAdminToken } from "../hooks/useAdminToken";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Mic2,
  Plus,
  X,
} from "lucide-react";

export default function AdminSongExploder() {
  const { token, saveToken, clearToken } = useAdminToken();

  if (!token) {
    return <TokenGate onSave={saveToken} />;
  }

  return <EpisodesPanel token={token} onClearToken={clearToken} />;
}

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          Admin access
        </div>
        <h1 className="mt-3 font-serif text-2xl font-semibold text-foreground">
          Enter admin token
        </h1>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) onSave(draft.trim());
          }}
        >
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Token"
            autoFocus
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

function EpisodesPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const queryClient = useQueryClient();
  const adminHeaders = { headers: { "x-admin-token": token } };

  const { data, isLoading, isError, refetch } = useListSongExploderEpisodes({
    request: adminHeaders,
  });

  const [selectedEpisode, setSelectedEpisode] =
    useState<SongExploderEpisodeListItem | null>(null);

  const episodes = data?.episodes ?? [];
  const resolved = episodes.filter((e) => e.mbid != null);
  const unresolved = episodes.filter((e) => e.mbid == null);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 flex items-center gap-2 font-serif text-3xl font-semibold text-foreground">
              <Mic2 className="h-7 w-7 text-primary" />
              Song Exploder anchors
            </h1>
          </div>
          <button
            type="button"
            onClick={onClearToken}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            Clear token
          </button>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          For each resolved episode, set the YouTube URL (enables ?t= timestamped
          linking) then add timeline anchors: song position + paraphrased label +
          deep-link.
        </p>

        {isLoading && (
          <div className="mt-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading episodes…</span>
          </div>
        )}
        {isError && (
          <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
            <p className="text-sm text-destructive-foreground">
              Could not load episodes. Check the admin token or server.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 font-mono text-[11px] text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {!isLoading && !isError && (
          <div className="mt-8 grid gap-8 lg:grid-cols-5">
            {/* Episode list */}
            <div className="lg:col-span-2">
              <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                Resolved ({resolved.length})
              </p>
              <ul className="flex flex-col gap-2">
                {resolved.map((ep) => (
                  <li key={ep.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedEpisode(
                          selectedEpisode?.id === ep.id ? null : ep,
                        )
                      }
                      className={[
                        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selectedEpisode?.id === ep.id
                          ? "border-primary/50 bg-primary/5"
                          : "border-card-border bg-card hover:border-primary/30",
                      ].join(" ")}
                    >
                      <p className="truncate text-sm font-medium text-foreground">
                        {ep.title}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
                        {ep.anchorCount} anchor{ep.anchorCount === 1 ? "" : "s"}
                        {ep.youtubeUrl ? " · YT ✓" : " · no YT URL"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
              {unresolved.length > 0 && (
                <>
                  <p className="mb-3 mt-6 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    Unresolved ({unresolved.length})
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {unresolved.map((ep) => (
                      <li
                        key={ep.id}
                        className="rounded-xl border border-card-border bg-card/50 px-3 py-2"
                      >
                        <p className="truncate text-sm text-muted-foreground">
                          {ep.title}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>

            {/* Anchor entry panel */}
            <div className="lg:col-span-3">
              {selectedEpisode ? (
                <EpisodeEditor
                  episode={selectedEpisode}
                  token={token}
                  onUpdated={() => {
                    void queryClient.invalidateQueries({
                      queryKey: getListSongExploderEpisodesQueryKey(),
                    });
                  }}
                />
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border bg-card/40 py-16 text-center">
                  <Mic2 className="h-10 w-10 text-muted-foreground/30" />
                  <p className="mt-4 font-serif text-lg text-muted-foreground">
                    Select an episode to add anchors
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EpisodeEditor({
  episode,
  token,
  onUpdated,
}: {
  episode: SongExploderEpisodeListItem;
  token: string;
  onUpdated: () => void;
}) {
  const adminHeaders = (extra?: Record<string, string>) => ({
    "Content-Type": "application/json",
    "x-admin-token": token,
    ...extra,
  });

  // YouTube URL editing
  const [ytDraft, setYtDraft] = useState(episode.youtubeUrl ?? "");
  const [ytSaving, setYtSaving] = useState(false);
  const [ytError, setYtError] = useState("");
  const [ytSaved, setYtSaved] = useState(false);

  async function saveYoutubeUrl() {
    setYtSaving(true);
    setYtError("");
    setYtSaved(false);
    try {
      const res = await fetch(`/api/admin/song-exploder/${episode.id}`, {
        method: "PATCH",
        headers: adminHeaders(),
        body: JSON.stringify({ youtubeUrl: ytDraft.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setYtSaved(true);
      onUpdated();
    } catch (err) {
      setYtError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setYtSaving(false);
    }
  }

  // Anchor entry
  const [songPos, setSongPos] = useState("");
  const [epPos, setEpPos] = useState("");
  const [label, setLabel] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(0);

  function parseTimecode(tc: string): number | null {
    const parts = tc.trim().split(":");
    if (parts.length === 2) {
      const m = parseInt(parts[0]!, 10);
      const s = parseInt(parts[1]!, 10);
      if (!isNaN(m) && !isNaN(s)) return (m * 60 + s) * 1000;
    }
    return null;
  }

  function buildDeepLink(): string {
    if (ytDraft.trim() && epPos.trim()) {
      const epMs = parseTimecode(epPos);
      if (epMs != null) {
        const secs = Math.floor(epMs / 1000);
        try {
          const url = new URL(ytDraft.trim());
          url.searchParams.set("t", String(secs));
          return url.toString();
        } catch {
          return ytDraft.trim();
        }
      }
    }
    return episode.episodeUrl;
  }

  const previewLink = buildDeepLink();

  async function submitAnchor() {
    const songMs = parseTimecode(songPos);
    if (!songMs) {
      setSubmitError("Enter song position as M:SS");
      return;
    }
    if (!label.trim()) {
      setSubmitError("Enter a paraphrased label");
      return;
    }
    if (!deepLink.trim() && !previewLink) {
      setSubmitError("Set a deep-link or YouTube URL above");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(
        `/api/admin/song-exploder/${episode.id}/claims`,
        {
          method: "POST",
          headers: adminHeaders(),
          body: JSON.stringify({
            offsetMs: songMs,
            text: label.trim(),
            sourceUrl: (deepLink.trim() || previewLink),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSongPos("");
      setEpPos("");
      setLabel("");
      setDeepLink("");
      setSubmitted((n) => n + 1);
      onUpdated();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5">
      {/* Episode header */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
            Editing episode
          </p>
          <p className="mt-0.5 font-serif text-lg font-semibold text-foreground">
            {episode.title}
          </p>
        </div>
        <a
          href={episode.episodeUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
        >
          <ExternalLink className="h-3 w-3" />
          Episode
        </a>
      </div>

      {submitted > 0 && (
        <p className="mt-3 font-mono text-[11px] text-primary">
          ✓ {submitted} anchor{submitted === 1 ? "" : "s"} saved
        </p>
      )}

      {/* YouTube URL */}
      <div className="mt-5">
        <label className="mb-1.5 block font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          YouTube URL (enables ?t= timestamped links)
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={ytDraft}
            onChange={(e) => {
              setYtDraft(e.target.value);
              setYtSaved(false);
            }}
            placeholder="https://youtube.com/watch?v=…"
            className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void saveYoutubeUrl()}
            disabled={ytSaving}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-opacity disabled:opacity-50"
          >
            {ytSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : ytSaved ? (
              <Check className="h-3.5 w-3.5" />
            ) : null}
            Save
          </button>
        </div>
        {ytError && (
          <p className="mt-1 text-xs text-destructive-foreground">{ytError}</p>
        )}
        {ytSaved && (
          <p className="mt-1 font-mono text-[11px] text-primary">Saved ✓</p>
        )}
      </div>

      {/* Anchor entry form */}
      <div className="mt-6 border-t border-border pt-5">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Add timeline anchor
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Song position (M:SS)
            </label>
            <input
              type="text"
              value={songPos}
              onChange={(e) => setSongPos(e.target.value)}
              placeholder="1:52"
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Episode position (M:SS)
            </label>
            <input
              type="text"
              value={epPos}
              onChange={(e) => setEpPos(e.target.value)}
              placeholder="4:10"
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="mb-1 block text-xs text-muted-foreground">
            Paraphrased topic label (never verbatim)
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Artist discusses the bass entry here"
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {/* Deep-link preview */}
        {(ytDraft.trim() || previewLink) && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-primary" />
            <a
              href={previewLink}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate font-mono text-[11px] text-primary hover:underline"
            >
              {previewLink}
            </a>
          </div>
        )}

        <div className="mt-3">
          <label className="mb-1 block text-xs text-muted-foreground">
            Override deep-link URL (leave blank to use preview above)
          </label>
          <input
            type="url"
            value={deepLink}
            onChange={(e) => setDeepLink(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
        </div>

        {submitError && (
          <p className="mt-2 text-xs text-destructive-foreground">
            {submitError}
          </p>
        )}

        <button
          type="button"
          onClick={() => void submitAnchor()}
          disabled={submitting}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add anchor
        </button>
      </div>
    </div>
  );
}
