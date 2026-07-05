import { useState } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { KeyRound, Loader2, Plus, Radio, Rss, Tag } from "lucide-react";

export default function AdminSelectors() {
  const { token, saveToken, clearToken } = useAdminToken();

  if (!token) {
    return <TokenGate onSave={saveToken} />;
  }

  return <SelectorsPanel token={token} onClearToken={clearToken} />;
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

function SelectorsPanel({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  return (
    <div className="min-h-screen">
      <div className="relative z-10 mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-foreground">
              Selectors
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
          Enrol new taste sources. Each entry is picked up by the relevant
          poller on its next cycle — no restart required.
        </p>

        <div className="mt-8 flex flex-col gap-6">
          <NtsShowForm token={token} />
          <BlogForm token={token} />
          <LabelForm token={token} />
        </div>
      </div>
    </div>
  );
}

// ── shared helpers ────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}{" "}
        {required ? (
          <span className="text-destructive-foreground">*</span>
        ) : hint ? (
          <span className="normal-case text-muted-foreground/60">({hint})</span>
        ) : null}
      </label>
      {children}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className="rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
    />
  );
}

function StatusBanner({
  ok,
  message,
  link,
}: {
  ok: boolean;
  message: string;
  link?: { href: string; label: string };
}) {
  if (ok) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
        {message}{" "}
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            {link.label} ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
      {message}
    </p>
  );
}

function SubmitButton({
  busy,
  disabled,
  label,
  busyLabel,
}: {
  busy: boolean;
  disabled?: boolean;
  label: string;
  busyLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Plus className="h-3.5 w-3.5" />
      )}
      {busy ? busyLabel : label}
    </button>
  );
}

// ── NTS show form ─────────────────────────────────────────────────────────────

interface NtsResult {
  pickerId: number;
  handle: string;
  name: string;
  alias: string;
  homeUrl: string;
}

function NtsShowForm({ token }: { token: string }) {
  const [alias, setAlias] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string; link?: { href: string; label: string } } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedAlias = alias.trim();
    if (!trimmedAlias) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/pickers/nts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          alias: trimmedAlias,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const body = (await res.json()) as NtsResult & { error?: string };
      if (!res.ok) {
        setStatus({ ok: false, message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({
        ok: true,
        message: `"${body.name}" enrolled as ${body.handle}.`,
        link: { href: body.homeUrl, label: "View on NTS" },
      });
      setAlias("");
      setName("");
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "Request failed — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">Add NTS show</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter a show's NTS alias (the slug in its URL, e.g.{" "}
        <code className="font-mono text-xs">floating-points</code>). The alias is
        validated against the NTS API and enrolled as a curator selector — the
        archive poller will start ingesting episodes on its next cycle.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
        <Field label="Show alias" required>
          <TextInput
            value={alias}
            onChange={setAlias}
            placeholder="e.g. questing-w-zakia"
            disabled={busy}
          />
        </Field>
        <Field label="Display name" hint="defaults to NTS show title">
          <TextInput
            value={name}
            onChange={setName}
            placeholder="e.g. Questing w/ Zakia"
            disabled={busy}
          />
        </Field>
        {status && <StatusBanner {...status} />}
        <SubmitButton busy={busy} disabled={!alias.trim()} label="Enrol show" busyLabel="Enrolling…" />
      </form>
    </div>
  );
}

// ── Blog / RSS form ───────────────────────────────────────────────────────────

interface BlogResult {
  pickerId: number;
  handle: string;
  name: string;
  found: number;
  matched: number | null;
  logged: number;
}

function BlogForm({ token }: { token: string }) {
  const [feedUrl, setFeedUrl] = useState("");
  const [name, setName] = useState("");
  const [homeUrl, setHomeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!feedUrl.trim() || !name.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/blogs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          feedUrl: feedUrl.trim(),
          name: name.trim(),
          ...(homeUrl.trim() ? { homeUrl: homeUrl.trim() } : {}),
        }),
      });
      const body = (await res.json()) as BlogResult & { error?: string };
      if (!res.ok) {
        setStatus({ ok: false, message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({
        ok: true,
        message: `"${body.name}" enrolled. ${body.found} posts found, ${body.logged} picks logged.`,
      });
      setFeedUrl("");
      setName("");
      setHomeUrl("");
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "Request failed — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Rss className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">Add blog / critic feed</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Ingest an RSS/Atom feed. Posts that yield a confident artist/track match
        become picks; the feed is re-polled automatically.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
        <Field label="Feed URL" required>
          <TextInput value={feedUrl} onChange={setFeedUrl} placeholder="https://example.com/feed/" disabled={busy} />
        </Field>
        <Field label="Display name" required>
          <TextInput value={name} onChange={setName} placeholder="e.g. Gorilla vs. Bear" disabled={busy} />
        </Field>
        <Field label="Homepage URL" hint="optional">
          <TextInput value={homeUrl} onChange={setHomeUrl} placeholder="https://example.com" disabled={busy} />
        </Field>
        {status && <StatusBanner {...status} />}
        <SubmitButton busy={busy} disabled={!feedUrl.trim() || !name.trim()} label="Ingest feed" busyLabel="Ingesting…" />
      </form>
    </div>
  );
}

// ── Label / MusicBrainz form ──────────────────────────────────────────────────

interface LabelResult {
  pickerId?: number;
  handle?: string;
  name?: string;
  error?: string;
}

function LabelForm({ token }: { token: string }) {
  const [labelMbid, setLabelMbid] = useState("");
  const [name, setName] = useState("");
  const [homeUrl, setHomeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!labelMbid.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          labelMbid: labelMbid.trim(),
          ...(name.trim() ? { name: name.trim() } : {}),
          ...(homeUrl.trim() ? { homeUrl: homeUrl.trim() } : {}),
        }),
      });
      const body = (await res.json()) as LabelResult;
      if (!res.ok) {
        setStatus({ ok: false, message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setStatus({ ok: true, message: `Label enrolled successfully.` });
      setLabelMbid("");
      setName("");
      setHomeUrl("");
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "Request failed — try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-primary" />
        <h2 className="font-serif text-lg font-semibold text-foreground">Add label</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Seed a label selector from a verified MusicBrainz label MBID. Every
        release on the label becomes a rideable pick at recording-ID confidence.
      </p>
      <form className="mt-5 flex flex-col gap-3" onSubmit={(e) => void handleSubmit(e)}>
        <Field label="MusicBrainz label MBID" required>
          <TextInput
            value={labelMbid}
            onChange={setLabelMbid}
            placeholder="e.g. e0a253c9-4b6f-4c7e-917b-3bc7dcb51234"
            disabled={busy}
          />
        </Field>
        <Field label="Display name" hint="optional — defaults to MusicBrainz label name">
          <TextInput value={name} onChange={setName} placeholder="e.g. Sacred Bones Records" disabled={busy} />
        </Field>
        <Field label="Homepage URL" hint="optional">
          <TextInput value={homeUrl} onChange={setHomeUrl} placeholder="https://example.com" disabled={busy} />
        </Field>
        {status && <StatusBanner {...status} />}
        <SubmitButton busy={busy} disabled={!labelMbid.trim()} label="Seed label" busyLabel="Seeding…" />
      </form>
    </div>
  );
}
