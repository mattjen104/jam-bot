import { useState, useCallback } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Globe,
  KeyRound,
  Loader2,
  MapPin,
  Music,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";

interface CriCandidate {
  id: number;
  criSlug: string;
  name: string;
  city: string | null;
  country: string | null;
  genres: string[];
  websiteUrl: string | null;
  streamUrl: string | null;
  icyStatus: string;
  alreadyInLore: boolean;
  notes: string | null;
  checkedAt: string;
}

type IcyFilter = "" | "yes" | "no" | "unknown";
type LoreFilter = "" | "true" | "false";

const ICY_LABELS: Record<string, string> = {
  yes: "ICY ✓",
  no: "no ICY",
  unknown: "untested",
};

const ICY_COLORS: Record<string, string> = {
  yes: "bg-zinc-500/15 text-zinc-400",
  no: "bg-zinc-500/15 text-zinc-400",
  unknown: "bg-muted/60 text-muted-foreground",
};

function fmtDate(iso: string): string {
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

export default function AdminCriCandidates() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <CriPanel token={token} onClearToken={clearToken} />;
}

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-card-border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-2 font-mono text-[13px] uppercase tracking-wide text-primary">
          <KeyRound className="h-3.5 w-3.5" />
          Admin access
        </div>
        <h1 className="mt-3 font-serif text-3xl font-normal text-foreground">
          Enter admin token
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
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
            className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            className="rounded-full bg-primary px-5 py-2 text-base font-normal text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}

function CriPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const [icyFilter, setIcyFilter] = useState<IcyFilter>("");
  const [loreFilter, setLoreFilter] = useState<LoreFilter>("");
  const [onlyPromotable, setOnlyPromotable] = useState(false);
  const [candidates, setCandidates] = useState<CriCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [didInit, setDidInit] = useState(false);

  const load = useCallback(
    async (icy: IcyFilter, lore: LoreFilter, promotable: boolean) => {
      setLoading(true);
      setFetchError(null);
      try {
        const params = new URLSearchParams();
        if (icy) params.set("icyStatus", icy);
        if (lore) params.set("alreadyInLore", lore);
        if (promotable) params.set("promotable", "true");
        const qs = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/admin/cri/candidates${qs}`, {
          headers: { "x-admin-token": token },
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { candidates: CriCandidate[] };
        setCandidates(data.candidates);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "Failed to load");
        setCandidates(null);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  if (!didInit) {
    setDidInit(true);
    void load(icyFilter, loreFilter, onlyPromotable);
  }

  function handleIcyFilter(f: IcyFilter) {
    setIcyFilter(f);
    setOnlyPromotable(false);
    void load(f, loreFilter, false);
  }

  function handleLoreFilter(f: LoreFilter) {
    setLoreFilter(f);
    setOnlyPromotable(false);
    void load(icyFilter, f, false);
  }

  function handlePromotable() {
    const next = !onlyPromotable;
    setOnlyPromotable(next);
    if (next) {
      setIcyFilter("");
      setLoreFilter("");
    }
    void load("", "", next);
  }

  function patchCandidate(updated: CriCandidate) {
    setCandidates((prev) =>
      prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
    );
  }

  const icyFilters: { label: string; value: IcyFilter }[] = [
    { label: "All ICY", value: "" },
    { label: "ICY ✓", value: "yes" },
    { label: "No ICY", value: "no" },
    { label: "Untested", value: "unknown" },
  ];

  const loreFilters: { label: string; value: LoreFilter }[] = [
    { label: "All", value: "" },
    { label: "Not in Lore", value: "false" },
    { label: "In Lore", value: "true" },
  ];

  const promotableCount =
    candidates?.filter((c) => c.icyStatus === "yes" && !c.alreadyInLore).length ?? 0;

  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[13px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-4xl font-normal text-foreground">
              CRI Candidates
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void load(icyFilter, loreFilter, onlyPromotable)}
              className="inline-flex items-center gap-1.5 font-mono text-[13px] text-muted-foreground/70 hover:text-primary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClearToken}
              className="font-mono text-[13px] text-muted-foreground/70 hover:text-primary"
            >
              Clear token
            </button>
          </div>
        </div>

        <AdminNav token={token} />

        <p className="mt-2 text-base text-muted-foreground">
          Stations discovered via the{" "}
          <a
            href="https://community.radio"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            Community Radio Index
          </a>{" "}
          and cross-referenced against Radio Browser. Only stations with{" "}
          <span className="font-mono text-sm">ICY ✓</span> deliver now-playing
          metadata and can be promoted to Lore.
        </p>

        {/* Filter bar — row 1: ICY status */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {icyFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleIcyFilter(f.value)}
              className={`rounded-full px-3 py-1 font-mono text-[13px] uppercase tracking-wide transition-colors ${
                icyFilter === f.value && !onlyPromotable
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="h-4 w-px bg-border" />
          {/* Lore status filters */}
          {loreFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => handleLoreFilter(f.value)}
              className={`rounded-full px-3 py-1 font-mono text-[13px] uppercase tracking-wide transition-colors ${
                loreFilter === f.value && !onlyPromotable
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="h-4 w-px bg-border" />
          <button
            type="button"
            onClick={handlePromotable}
            className={`rounded-full px-3 py-1 font-mono text-[13px] uppercase tracking-wide transition-colors ${
              onlyPromotable
                ? "bg-zinc-600 text-white"
                : "border border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            Promotable{promotableCount > 0 && !onlyPromotable ? ` (${promotableCount})` : ""}
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div className="mt-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-base">Loading candidates…</span>
          </div>
        )}

        {/* Error */}
        {fetchError && !loading && (
          <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
            <div className="flex items-center gap-2 text-base text-destructive-foreground">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {fetchError}
            </div>
            <button
              type="button"
              onClick={() => void load(icyFilter, loreFilter, onlyPromotable)}
              className="mt-3 font-mono text-[13px] text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!loading && !fetchError && candidates?.length === 0 && (
          <div className="mt-12 rounded-2xl border border-card-border bg-card p-8 text-center">
            <Music className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-4 font-serif text-xl text-foreground">No candidates</p>
            <p className="mt-1 text-base text-muted-foreground">
              {onlyPromotable
                ? "No stations are ready to promote right now."
                : "No CRI candidates found with the current filter."}
            </p>
          </div>
        )}

        {/* Count */}
        {!loading && candidates && candidates.length > 0 && (
          <p className="mt-4 font-mono text-[13px] text-muted-foreground/70">
            {candidates.length} candidate{candidates.length === 1 ? "" : "s"}
          </p>
        )}

        {/* List */}
        <ul className="mt-4 flex flex-col gap-3">
          {(candidates ?? []).map((c) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              token={token}
              onPromoted={patchCandidate}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
  token,
  onPromoted,
}: {
  candidate: CriCandidate;
  token: string;
  onPromoted: (updated: CriCandidate) => void;
}) {
  const [promoting, setPromoting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promoted, setPromoted] = useState(false);

  const canPromote = candidate.icyStatus === "yes" && !candidate.alreadyInLore && !promoted;

  async function handlePromote() {
    setPromoting(true);
    setPromoteError(null);
    try {
      const res = await fetch(
        `/api/admin/cri/candidates/${encodeURIComponent(candidate.criSlug)}/promote`,
        { method: "POST", headers: { "x-admin-token": token } },
      );
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setPromoted(true);
      onPromoted({ ...candidate, alreadyInLore: true });
    } catch (err) {
      setPromoteError(err instanceof Error ? err.message : "Promote failed — try again.");
    } finally {
      setPromoting(false);
    }
  }

  return (
    <li className="rounded-xl border border-card-border bg-card px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        {/* Left: name + meta */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[12px] uppercase tracking-wide ${
                ICY_COLORS[candidate.icyStatus] ?? "bg-muted/60 text-muted-foreground"
              }`}
            >
              {ICY_LABELS[candidate.icyStatus] ?? candidate.icyStatus}
            </span>
            {candidate.alreadyInLore && (
              <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[12px] uppercase tracking-wide text-primary">
                In Lore
              </span>
            )}
          </div>
          <p className="mt-1.5 font-normal text-foreground leading-snug">{candidate.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {(candidate.city || candidate.country) && (
              <span className="flex items-center gap-1 font-mono text-[13px] text-muted-foreground/70">
                <MapPin className="h-3 w-3" />
                {[candidate.city, candidate.country].filter(Boolean).join(", ")}
              </span>
            )}
            {candidate.genres.length > 0 && (
              <span className="flex items-center gap-1 font-mono text-[13px] text-muted-foreground/70">
                <Music className="h-3 w-3" />
                {candidate.genres.slice(0, 3).join(" · ")}
              </span>
            )}
          </div>
          {candidate.streamUrl && (
            <a
              href={candidate.streamUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate font-mono text-[13px] text-muted-foreground/60 hover:text-primary"
              title={candidate.streamUrl}
            >
              {candidate.streamUrl}
            </a>
          )}
          <p className="mt-0.5 font-mono text-[12px] text-muted-foreground/50">
            Checked {fmtDate(candidate.checkedAt)}
          </p>
        </div>

        {/* Right: links + status icon */}
        <div className="flex shrink-0 items-center gap-2">
          {candidate.icyStatus === "yes" ? (
            <Wifi className="h-3.5 w-3.5 text-zinc-500" />
          ) : candidate.icyStatus === "no" ? (
            <WifiOff className="h-3.5 w-3.5 text-zinc-500" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground/40" />
          )}
          {candidate.websiteUrl && (
            <a
              href={candidate.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[13px] text-muted-foreground/60 hover:text-primary"
              title="Station website"
            >
              <Globe className="h-3.5 w-3.5" />
            </a>
          )}
          {candidate.streamUrl && (
            <a
              href={`https://community.radio/stations/${candidate.criSlug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[13px] text-muted-foreground/60 hover:text-primary"
              title="CRI page"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Notes */}
      {candidate.notes && (
        <p className="mt-2 rounded-lg bg-secondary/40 px-3 py-1.5 font-mono text-[13px] text-muted-foreground">
          {candidate.notes}
        </p>
      )}

      {/* Promote button + error */}
      {(canPromote || candidate.alreadyInLore || promoted) && (
        <div className="mt-3 flex items-center gap-2">
          {candidate.alreadyInLore || promoted ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 font-mono text-[13px] text-primary">
              <Check className="h-3 w-3" />
              Promoted to Lore
            </span>
          ) : (
            <button
              type="button"
              disabled={promoting}
              onClick={() => void handlePromote()}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-600/90 px-4 py-1.5 font-mono text-[13px] text-white shadow-sm transition-opacity hover:bg-zinc-600 disabled:opacity-50"
            >
              {promoting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Wifi className="h-3 w-3" />
              )}
              {promoting ? "Promoting…" : "Promote to Lore"}
            </button>
          )}
        </div>
      )}
      {promoteError && (
        <p className="mt-1.5 text-sm text-destructive-foreground">{promoteError}</p>
      )}
    </li>
  );
}
