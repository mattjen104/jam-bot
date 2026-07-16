import { useState, useCallback } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  KeyRound,
  List,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Candidate {
  id: number;
  pickerId: number;
  pickerHandle: string;
  pickerName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  status: string;
  processedAt: string | null;
  note: string | null;
  createdAt: string;
  listId: number | null;
}

interface ListEntry {
  id: number;
  listId: number;
  releaseGroupMbid: string;
  rank: number | null;
  blurbUrl: string | null;
  rawArtist: string | null;
  rawAlbum: string | null;
  confidence: string;
  confirmed: boolean;
}

type StatusFilter = "" | "pending" | "extracted" | "failed" | "skipped";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  extracted: "Extracted",
  failed: "Failed",
  skipped: "Skipped",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400",
  extracted: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive-foreground",
  skipped: "bg-muted/60 text-muted-foreground",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  exact: "bg-emerald-500/15 text-emerald-400",
  fuzzy: "bg-amber-500/15 text-amber-400",
  unresolved: "bg-destructive/15 text-destructive-foreground",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

// ---------------------------------------------------------------------------
// Top-level export with TokenGate
// ---------------------------------------------------------------------------

export default function AdminListCandidates() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <CandidatesPanel token={token} onClearToken={clearToken} />;
}

// ---------------------------------------------------------------------------
// TokenGate
// ---------------------------------------------------------------------------

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
        <p className="mt-1 text-sm text-muted-foreground">
          Stored in your browser — you won't need to re-enter it.
        </p>
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

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

function CandidatesPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const adminHeaders = { "x-admin-token": token };

  const loadCandidates = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setFetchError(null);
      try {
        const qs = status ? `?status=${status}` : "";
        const res = await fetch(`/api/admin/lore/list-candidates${qs}`, {
          headers: adminHeaders,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { candidates: Candidate[] };
        setCandidates(data.candidates);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load");
        setCandidates(null);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );

  // Load on first render
  const [didInit, setDidInit] = useState(false);
  if (!didInit) {
    setDidInit(true);
    void loadCandidates(statusFilter);
  }

  function handleFilterChange(f: StatusFilter) {
    setStatusFilter(f);
    void loadCandidates(f);
  }

  function refreshCandidate(updated: Candidate) {
    setCandidates((prev) =>
      prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
    );
  }

  const filters: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "" },
    { label: "Pending", value: "pending" },
    { label: "Extracted", value: "extracted" },
    { label: "Failed", value: "failed" },
    { label: "Skipped", value: "skipped" },
  ];

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-4xl px-4 py-10 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-foreground">
              List candidates
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void loadCandidates(statusFilter)}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClearToken}
              className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
            >
              Clear token
            </button>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleFilterChange(f.value)}
              className={`rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors ${
                statusFilter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading candidates…</span>
          </div>
        )}

        {/* Error */}
        {fetchError && !loading && (
          <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
            <div className="flex items-center gap-2 text-sm text-destructive-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {fetchError}
            </div>
            <button
              type="button"
              onClick={() => void loadCandidates(statusFilter)}
              className="mt-3 font-mono text-[11px] text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !fetchError && candidates?.length === 0 && (
          <div className="mt-12 rounded-2xl border border-card-border bg-card p-8 text-center">
            <List className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-4 font-serif text-lg text-foreground">
              No candidates
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {statusFilter
                ? `No ${STATUS_LABELS[statusFilter]?.toLowerCase() ?? statusFilter} candidates yet.`
                : "No list candidates have been queued yet."}
            </p>
          </div>
        )}

        {/* Count */}
        {!loading && candidates && candidates.length > 0 && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
          </p>
        )}

        {/* Candidate list */}
        <ul className="mt-4 flex flex-col gap-4">
          {(candidates ?? []).map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              token={token}
              onRetried={refreshCandidate}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Candidate card
// ---------------------------------------------------------------------------

function CandidateCard({
  candidate,
  token,
  onRetried,
}: {
  candidate: Candidate;
  token: string;
  onRetried: (updated: Candidate) => void;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [showEntries, setShowEntries] = useState(false);

  const needsReview =
    (candidate.status === "extracted" || candidate.status === "skipped") &&
    candidate.listId != null;

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(
        `/api/admin/lore/list-candidates/${candidate.id}/retry`,
        {
          method: "POST",
          headers: { "x-admin-token": token },
        },
      );
      const body = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((body["error"] as string | undefined) ?? `HTTP ${res.status}`);
      }
      onRetried({
        ...candidate,
        status: body["status"] as string ?? candidate.status,
        note: body["note"] as string | null ?? candidate.note,
        processedAt: new Date().toISOString(),
        listId: (body["listId"] as number | null | undefined) ?? candidate.listId,
      });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="rounded-2xl border border-card-border bg-card p-5">
      {/* Top row: status + title + link */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                STATUS_COLORS[candidate.status] ?? "bg-muted/60 text-muted-foreground"
              }`}
            >
              {STATUS_LABELS[candidate.status] ?? candidate.status}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground/70">
              {candidate.pickerName}
            </span>
          </div>
          <p className="mt-1.5 font-medium text-foreground leading-snug">
            {candidate.title}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/60">
            Published {fmtDate(candidate.publishedAt)} · Queued{" "}
            {fmtDate(candidate.createdAt)}
            {candidate.processedAt && (
              <> · Processed {fmtDate(candidate.processedAt)}</>
            )}
          </p>
        </div>
        <a
          href={candidate.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
          Post
        </a>
      </div>

      {/* Note */}
      {candidate.note && (
        <p className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {candidate.note}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Retry button: show for pending/failed; show for extracted/skipped as re-scrape */}
        <button
          type="button"
          disabled={retrying}
          onClick={() => void handleRetry()}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
        >
          {retrying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {retrying ? "Retrying…" : "Retry"}
        </button>

        {/* Review entries button: shown when a list exists */}
        {needsReview && (
          <button
            type="button"
            onClick={() => setShowEntries((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-primary/20"
          >
            {showEntries ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Review entries
          </button>
        )}
      </div>

      {retryError && (
        <p className="mt-1.5 text-xs text-destructive-foreground">{retryError}</p>
      )}

      {/* Inline entries review panel */}
      {showEntries && candidate.listId != null && (
        <EntriesReviewPanel
          listId={candidate.listId}
          token={token}
        />
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Entries review panel (fuzzy/unresolved matches)
// ---------------------------------------------------------------------------

function EntriesReviewPanel({
  listId,
  token,
}: {
  listId: number;
  token: string;
}) {
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const adminHeaders = { "x-admin-token": token };

  const loadEntries = useCallback(
    async (all: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const filter = all ? "" : "?filter=pending";
        const res = await fetch(`/api/admin/lists/${listId}/entries${filter}`, {
          headers: adminHeaders,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json() as { entries: ListEntry[] };
        setEntries(data.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load entries");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listId, token],
  );

  const [didInit, setDidInit] = useState(false);
  if (!didInit) {
    setDidInit(true);
    void loadEntries(showAll);
  }

  function handleToggleAll() {
    const next = !showAll;
    setShowAll(next);
    setEntries(null);
    void loadEntries(next);
  }

  function updateEntry(updated: ListEntry) {
    setEntries((prev) =>
      prev ? prev.map((e) => (e.id === updated.id ? updated : e)) : prev,
    );
  }

  const pendingCount = entries?.filter(
    (e) => !e.confirmed && e.confidence !== "exact",
  ).length ?? 0;

  return (
    <div className="mt-4 rounded-xl border border-border bg-secondary/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          List #{listId} entries
        </p>
        <div className="flex items-center gap-3">
          {!loading && entries && (
            <span className="font-mono text-[11px] text-muted-foreground/60">
              {showAll
                ? `${entries.length} total`
                : `${pendingCount} need review`}
            </span>
          )}
          <button
            type="button"
            onClick={handleToggleAll}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            {showAll ? "Show pending only" : "Show all"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-4 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span className="text-sm">Loading entries…</span>
        </div>
      )}

      {error && !loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-destructive-foreground">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && entries?.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          {showAll
            ? "No entries in this list yet."
            : "No pending entries — all matches are confirmed or exact."}
        </p>
      )}

      {!loading && entries && entries.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              token={token}
              onUpdated={updateEntry}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single entry row with confirm / correct actions
// ---------------------------------------------------------------------------

function EntryRow({
  entry,
  token,
  onUpdated,
}: {
  entry: ListEntry;
  token: string;
  onUpdated: (updated: ListEntry) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [correctedMbid, setCorrectedMbid] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);

  const adminHeaders = {
    "x-admin-token": token,
    "Content-Type": "application/json",
  };

  async function patchEntry(body: { confirmed: boolean; releaseGroupMbid?: string }) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/admin/lists/${entry.listId}/entries/${entry.id}`,
        {
          method: "PATCH",
          headers: adminHeaders,
          body: JSON.stringify(body),
        },
      );
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data["error"] as string | undefined) ?? `HTTP ${res.status}`);
      }
      onUpdated(data as unknown as ListEntry);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    await patchEntry({ confirmed: true });
  }

  async function handleCorrect() {
    const mbid = correctedMbid.trim();
    if (!mbid) {
      setErr("Enter a MusicBrainz release group MBID.");
      return;
    }
    await patchEntry({ confirmed: true, releaseGroupMbid: mbid });
    setCorrectedMbid("");
    setShowCorrect(false);
  }

  async function handleReject() {
    await patchEntry({ confirmed: false });
  }

  const isConfirmed = entry.confirmed;
  const confidenceBadge = (
    <span
      className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
        CONFIDENCE_COLORS[entry.confidence] ?? "bg-muted/60 text-muted-foreground"
      }`}
    >
      {entry.confidence}
    </span>
  );

  return (
    <li className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        {/* Rank */}
        <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground/50">
          {entry.rank ?? "—"}
        </span>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {confidenceBadge}
            {isConfirmed && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-400">
                confirmed
              </span>
            )}
          </div>
          <p className="mt-1 font-medium text-sm text-foreground">
            {entry.rawAlbum ?? <span className="text-muted-foreground italic">no album</span>}
          </p>
          <p className="text-sm text-muted-foreground">
            {entry.rawArtist ?? <span className="italic">no artist</span>}
          </p>
          {entry.confidence !== "unresolved" && (
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50 truncate">
              MB: {entry.releaseGroupMbid}
            </p>
          )}
        </div>

        {/* Actions (only for unconfirmed non-exact entries) */}
        {!isConfirmed && entry.confidence !== "exact" && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConfirm()}
              title="Confirm this match"
              className="inline-flex items-center justify-center rounded-full bg-primary/10 p-1.5 text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowCorrect((v) => !v)}
              title="Correct this match with a different MBID"
              className="inline-flex items-center justify-center rounded-full border border-border p-1.5 text-muted-foreground hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleReject()}
              title="Mark as unresolved / reject this match"
              className="inline-flex items-center justify-center rounded-full border border-border p-1.5 text-muted-foreground hover:border-destructive/50 hover:text-destructive-foreground disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Already confirmed exact — show tick */}
        {(isConfirmed || entry.confidence === "exact") && !showCorrect && (
          <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />
        )}
      </div>

      {/* Inline MBID correction form */}
      {showCorrect && (
        <div className="mt-2 flex items-center gap-2 pl-9">
          <input
            type="text"
            value={correctedMbid}
            onChange={(e) => setCorrectedMbid(e.target.value)}
            placeholder="Correct release group MBID (e.g. a1b2c3d4-…)"
            className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            disabled={busy || !correctedMbid.trim()}
            onClick={() => void handleCorrect()}
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Apply
          </button>
          <button
            type="button"
            onClick={() => { setShowCorrect(false); setCorrectedMbid(""); }}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            Cancel
          </button>
        </div>
      )}

      {err && (
        <p className="mt-1 pl-9 text-xs text-destructive-foreground">{err}</p>
      )}
    </li>
  );
}
