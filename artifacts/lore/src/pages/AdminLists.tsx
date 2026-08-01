import { useState, useCallback, useEffect } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListSource {
  id: number;
  kind: string;
  name: string;
  homepageUrl: string | null;
  pickerId: number | null;
  stationId: number | null;
  createdAt: string;
}

interface ListEntry {
  id: number;
  listId: number;
  releaseGroupMbid: string;
  rank: number | null;
  rawArtist: string | null;
  rawAlbum: string | null;
  confidence: string;
  confirmed: boolean;
  blurbUrl: string | null;
}

interface ScrapeResult {
  listId: number;
  total: number;
  resolved: number;
  fuzzy: number;
  unresolved: number;
  error?: string | null;
}

interface AotyImportResult {
  enrolled: number;
  linkOutOnly: number;
  skipped: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENCE_BADGE: Record<string, string> = {
  exact: "bg-emerald-500/15 text-emerald-400",
  fuzzy: "bg-amber-500/15 text-amber-400",
  unresolved: "bg-destructive/15 text-destructive-foreground",
};

function fmtDate(iso: string | null | undefined): string {
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

export default function AdminLists() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <ListsPanel token={token} onClearToken={clearToken} />;
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

function ListsPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const adminHeaders = { "x-admin-token": token, "Content-Type": "application/json" };

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
              List sources
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

        <AdminNav token={token} />

        {/* AOTY import panel */}
        <AotyImportPanel adminHeaders={adminHeaders} />

        {/* Process-batch panel */}
        <ProcessBatchPanel adminHeaders={adminHeaders} />

        {/* List sources table */}
        <ListSourcesPanel adminHeaders={adminHeaders} />

        {/* Scrape trigger */}
        <ScrapeTriggerPanel adminHeaders={adminHeaders} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AOTY Import Panel
// ---------------------------------------------------------------------------

function AotyImportPanel({
  adminHeaders,
}: {
  adminHeaders: Record<string, string>;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AotyImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleImport() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/aoty-publications/import", {
        method: "POST",
        headers: adminHeaders,
      });
      const body = await res.json() as AotyImportResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-lg font-semibold text-foreground">
            Import AOTY sources
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fetch the Album of the Year publications list, run RSS autodiscovery on
            each home URL, and enroll the results as blog pickers awaiting review.
            Publications without feeds are registered as link-out-only.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {loading ? "Importing…" : "Import AOTY sources"}
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 rounded-lg bg-secondary/40 px-4 py-3">
          <div className="flex flex-wrap gap-6 font-mono text-sm">
            <span>
              <span className="text-emerald-400">{result.enrolled}</span>
              <span className="ml-1.5 text-muted-foreground">enrolled with feed</span>
            </span>
            <span>
              <span className="text-amber-400">{result.linkOutOnly}</span>
              <span className="ml-1.5 text-muted-foreground">link-out only</span>
            </span>
            <span>
              <span className="text-muted-foreground/60">{result.skipped}</span>
              <span className="ml-1.5 text-muted-foreground">skipped</span>
            </span>
          </div>
          {result.note && (
            <p className="mt-2 text-xs text-muted-foreground">{result.note}</p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Process-batch Panel
// ---------------------------------------------------------------------------

function ProcessBatchPanel({
  adminHeaders,
}: {
  adminHeaders: Record<string, string>;
}) {
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState("20");
  const [result, setResult] = useState<{ processed: number; outcomes: Array<{ id: number; title: string; status: string; note: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBatch() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const n = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
      const res = await fetch(`/api/admin/list-candidates/process-batch?limit=${n}`, {
        method: "POST",
        headers: adminHeaders,
      });
      const body = await res.json() as typeof result & { error?: string };
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">
        Process pending candidates (backfill)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Run extraction on pending list candidates immediately, bypassing the
        daily cap. Use after enrolling a new publication cohort.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <label className="font-mono text-[11px] text-muted-foreground">
          Limit
        </label>
        <input
          type="number"
          min={1}
          max={50}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-20 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleBatch()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/80 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {loading ? "Processing…" : "Run batch"}
        </button>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-muted-foreground/70">
            {result.processed} candidate{result.processed === 1 ? "" : "s"} processed
          </p>
          {result.outcomes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.outcomes.map((o) => (
                <li key={o.id} className="flex items-start gap-2 rounded-lg bg-secondary/30 px-3 py-2">
                  <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
                    o.status === "extracted"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : o.status === "failed"
                      ? "bg-destructive/15 text-destructive-foreground"
                      : "bg-muted/60 text-muted-foreground"
                  }`}>
                    {o.status}
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-foreground leading-snug">{o.title}</span>
                  {o.note && (
                    <span className="shrink-0 text-[11px] text-muted-foreground/60">{o.note}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// List Sources Panel
// ---------------------------------------------------------------------------

function ListSourcesPanel({
  adminHeaders,
}: {
  adminHeaders: Record<string, string>;
}) {
  const [sources, setSources] = useState<ListSource[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/list-sources", { headers: adminHeaders });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { sources: ListSource[] };
      setSources(body.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminHeaders]);

  useEffect(() => {
    void loadSources();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-semibold text-foreground">
          List sources
        </h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void loadSources()}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" />
            New source
          </button>
        </div>
      </div>

      {showForm && (
        <NewSourceForm
          adminHeaders={adminHeaders}
          onCreated={() => {
            setShowForm(false);
            void loadSources();
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      )}

      {error && !loading && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && sources && sources.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          No list sources yet. Create one below or run the AOTY import.
        </p>
      )}

      {!loading && sources && sources.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <th className="pb-2 text-left">Name</th>
                <th className="pb-2 text-left">Kind</th>
                <th className="pb-2 text-left">Homepage</th>
                <th className="pb-2 text-right">Picker</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sources.map((s) => (
                <tr key={s.id}>
                  <td className="py-2 pr-4 text-foreground">{s.name}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-secondary/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {s.kind}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {s.homepageUrl ? (
                      <a
                        href={s.homepageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                        {s.homepageUrl.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right font-mono text-[11px] text-muted-foreground/60">
                    {s.pickerId ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// New Source Form
// ---------------------------------------------------------------------------

function NewSourceForm({
  adminHeaders,
  onCreated,
  onCancel,
}: {
  adminHeaders: Record<string, string>;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"publication" | "selector" | "station">("publication");
  const [homepageUrl, setHomepageUrl] = useState("");
  const [pickerId, setPickerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { kind, name: name.trim() };
      if (homepageUrl.trim()) body.homepageUrl = homepageUrl.trim();
      if (pickerId.trim()) body.pickerId = parseInt(pickerId.trim(), 10);

      const res = await fetch("/api/admin/list-sources", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-4 rounded-xl border border-border bg-secondary/20 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Pitchfork"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Kind
          </label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
            className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            <option value="publication">Publication</option>
            <option value="selector">Selector</option>
            <option value="station">Station</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Homepage URL
          </label>
          <input
            value={homepageUrl}
            onChange={(e) => setHomepageUrl(e.target.value)}
            type="url"
            placeholder="https://pitchfork.com"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Picker ID (optional)
          </label>
          <input
            value={pickerId}
            onChange={(e) => setPickerId(e.target.value)}
            type="number"
            placeholder="123"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive-foreground">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : "Create source"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Scrape Trigger Panel
// ---------------------------------------------------------------------------

function ScrapeTriggerPanel({
  adminHeaders,
}: {
  adminHeaders: Record<string, string>;
}) {
  const [sources, setSources] = useState<ListSource[]>([]);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [year, setYear] = useState("");
  const [kind, setKind] = useState<"year_end" | "mid_year" | "decade" | "all_time" | "genre" | "custom">("year_end");
  const [isRanked, setIsRanked] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [showEntries, setShowEntries] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/list-sources", { headers: adminHeaders })
      .then((r) => r.json())
      .then((b: unknown) => {
        const body = b as { sources?: ListSource[] };
        setSources(body.sources ?? []);
        if ((body.sources ?? []).length > 0 && !sourceId) {
          setSourceId(String(body.sources![0]!.id));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleScrape(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || !title.trim() || !sourceId) return;
    setScraping(true);
    setScrapeError(null);
    setScrapeResult(null);
    setShowEntries(false);

    try {
      const body: Record<string, unknown> = {
        url: url.trim(),
        title: title.trim(),
        sourceId: parseInt(sourceId, 10),
        kind,
        isRanked,
      };
      if (year.trim()) body.year = parseInt(year.trim(), 10);

      const res = await fetch("/api/admin/lists/scrape", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json() as ScrapeResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setScrapeResult(data);
    } catch (err) {
      setScrapeError(err instanceof Error ? err.message : "Scrape failed");
    } finally {
      setScraping(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl border border-card-border bg-card p-6">
      <h2 className="font-serif text-lg font-semibold text-foreground">
        Scrape a list URL
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste a critic year-end list URL, select its source, and trigger
        extraction. Exact matches auto-confirm; fuzzy and unresolved entries
        wait in the review queue.
      </p>

      <form
        onSubmit={(e) => void handleScrape(e)}
        className="mt-4 flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            URL *
          </label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            type="url"
            required
            placeholder="https://pitchfork.com/features/lists-and-guides/best-albums-2024/"
            className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              placeholder="The 50 Best Albums of 2024"
              className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Source *
            </label>
            {sources.length > 0 ? (
              <select
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                required
                className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                type="number"
                required
                placeholder="Source ID"
                className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
              />
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Kind
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            >
              <option value="year_end">Year-end</option>
              <option value="mid_year">Mid-year</option>
              <option value="decade">Decade</option>
              <option value="all_time">All-time</option>
              <option value="genre">Genre</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Year
            </label>
            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              type="number"
              placeholder="2024"
              min={1950}
              max={2099}
              className="rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isRanked}
            onChange={(e) => setIsRanked(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Ranked list (numbered, e.g. "Top 50")
        </label>

        <div>
          <button
            type="submit"
            disabled={scraping || !url.trim() || !title.trim() || !sourceId}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
          >
            {scraping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5" />
            )}
            {scraping ? "Scraping…" : "Scrape list"}
          </button>
        </div>
      </form>

      {scrapeError && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {scrapeError}
        </div>
      )}

      {scrapeResult && !scrapeError && (
        <div className="mt-4">
          <div className="rounded-lg bg-secondary/40 px-4 py-3">
            <div className="flex flex-wrap gap-6 font-mono text-sm">
              <span>
                <span className="text-foreground">{scrapeResult.total}</span>
                <span className="ml-1.5 text-muted-foreground">total</span>
              </span>
              <span>
                <span className="text-emerald-400">{scrapeResult.resolved}</span>
                <span className="ml-1.5 text-muted-foreground">exact</span>
              </span>
              <span>
                <span className="text-amber-400">{scrapeResult.fuzzy}</span>
                <span className="ml-1.5 text-muted-foreground">fuzzy</span>
              </span>
              <span>
                <span className="text-destructive-foreground">{scrapeResult.unresolved}</span>
                <span className="ml-1.5 text-muted-foreground">unresolved</span>
              </span>
            </div>
            {scrapeResult.error && (
              <p className="mt-1 text-xs text-destructive-foreground">{scrapeResult.error}</p>
            )}
          </div>

          {(scrapeResult.fuzzy > 0 || scrapeResult.unresolved > 0) && (
            <button
              type="button"
              onClick={() => setShowEntries((v) => !v)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary hover:bg-primary/20"
            >
              {showEntries ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Review entries
            </button>
          )}

          {showEntries && (
            <EntriesPanel
              listId={scrapeResult.listId}
              adminHeaders={adminHeaders}
            />
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Entries Review Panel (reusable)
// ---------------------------------------------------------------------------

function EntriesPanel({
  listId,
  adminHeaders,
}: {
  listId: number;
  adminHeaders: Record<string, string>;
}) {
  const [entries, setEntries] = useState<ListEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(
    async (all: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const filter = all ? "" : "?filter=pending";
        const res = await fetch(`/api/admin/lists/${listId}/entries${filter}`, {
          headers: adminHeaders,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json() as { entries: ListEntry[] };
        setEntries(body.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listId],
  );

  useEffect(() => {
    void load(showAll);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  async function handleConfirm(entry: ListEntry) {
    try {
      const res = await fetch(`/api/admin/lists/${listId}/entries/${entry.id}`, {
        method: "PATCH",
        headers: adminHeaders,
        body: JSON.stringify({ confirmed: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries((prev) =>
        prev
          ? prev.map((e) =>
              e.id === entry.id ? { ...e, confirmed: true } : e,
            )
          : prev,
      );
    } catch {
      /* ignore confirm error */
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/20 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[11px] text-muted-foreground/70">
          {showAll ? "All entries" : "Needs review"} — list #{listId}
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-mono text-[11px] text-primary hover:underline"
          >
            {showAll ? "Show pending only" : "Show all"}
          </button>
          <button
            type="button"
            onClick={() => void load(showAll)}
            className="font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {error && !loading && (
        <p className="mt-2 text-xs text-destructive-foreground">{error}</p>
      )}

      {!loading && entries && entries.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No entries to review.</p>
      )}

      {!loading && entries && entries.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                <th className="pb-2 text-left">Rank</th>
                <th className="pb-2 text-left">Artist</th>
                <th className="pb-2 text-left">Album</th>
                <th className="pb-2 text-center">Confidence</th>
                <th className="pb-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((e) => (
                <tr key={e.id} className={e.confirmed ? "opacity-50" : ""}>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground/60">
                    {e.rank ?? "—"}
                  </td>
                  <td className="py-2 pr-3 text-foreground">{e.rawArtist ?? "—"}</td>
                  <td className="py-2 pr-3 text-foreground">{e.rawAlbum ?? "—"}</td>
                  <td className="py-2 pr-3 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
                        CONFIDENCE_BADGE[e.confidence] ?? "bg-muted/60 text-muted-foreground"
                      }`}
                    >
                      {e.confidence}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {!e.confirmed && e.confidence === "exact" && (
                      <button
                        type="button"
                        onClick={() => void handleConfirm(e)}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-400 hover:bg-emerald-500/25"
                      >
                        <Check className="h-3 w-3" />
                        Confirm
                      </button>
                    )}
                    {e.confirmed && (
                      <span className="font-mono text-[10px] text-emerald-400/60">✓</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
