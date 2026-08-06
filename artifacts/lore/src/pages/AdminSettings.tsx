import { useState, useEffect, useCallback } from "react";
import { useAdminToken } from "../hooks/useAdminToken";
import { AdminNav } from "@/components/AdminNav";
import { KeyRound, Loader2, ToggleLeft, ToggleRight } from "lucide-react";

// ─── API shapes ────────────────────────────────────────────────────────────

interface Setting {
  key: string;
  value: boolean;
  source: "db" | "env";
  updatedAt: string | null;
}

interface SettingsResponse {
  settings: Setting[];
}

// ─── Labels / descriptions ─────────────────────────────────────────────────

const SETTING_META: Record<string, { label: string; description: string }> = {
  spotifyImportEnabled: {
    label: "Spotify direct import",
    description:
      "Allow listeners to import their Spotify library directly into Lore. When off, the import route returns 403 and the UI hides the Spotify import option.",
  },
};

// ─── Token gate ────────────────────────────────────────────────────────────

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
        <input
          className="mt-5 w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary"
          type="password"
          placeholder="Admin token"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) onSave(draft.trim()); }}
        />
        <button
          className="mt-3 w-full rounded-lg bg-primary px-4 py-2 text-base font-normal text-primary-foreground disabled:opacity-40"
          disabled={!draft.trim()}
          onClick={() => onSave(draft.trim())}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

// ─── Settings panel ────────────────────────────────────────────────────────

function SettingsPanel({ token, onClearToken }: { token: string; onClearToken: () => void }) {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings", {
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        onClearToken();
        return;
      }
      if (!res.ok) {
        setError("Failed to load settings");
        return;
      }
      const data = (await res.json()) as SettingsResponse;
      setSettings(data.settings);
      setError(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [token, onClearToken]);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const toggle = useCallback(async (key: string, currentValue: boolean) => {
    setToggling((s) => new Set(s).add(key));
    try {
      const res = await fetch(`/api/admin/settings/${encodeURIComponent(key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": token },
        body: JSON.stringify({ value: !currentValue }),
      });
      if (!res.ok) {
        setError("Failed to update setting");
        return;
      }
      const updated = (await res.json()) as { key: string; value: boolean };
      setSettings((prev) =>
        prev?.map((s) =>
          s.key === updated.key
            ? { ...s, value: updated.value, source: "db", updatedAt: new Date().toISOString() }
            : s,
        ) ?? prev,
      );
    } catch {
      setError("Network error");
    } finally {
      setToggling((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
  }, [token]);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <AdminNav token={token} />

      <div className="mt-8 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-normal text-foreground">Runtime settings</h1>
          <p className="mt-1 text-base text-muted-foreground">
            Toggle feature flags without restarting the server. Changes take effect within ~30 s.
          </p>
        </div>
        <button
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={onClearToken}
        >
          Sign out
        </button>
      </div>

      {loading && (
        <div className="mt-10 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-base">Loading settings…</span>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-base text-destructive">
          {error}
        </div>
      )}

      {settings && (
        <div className="mt-6 space-y-3">
          {settings.map((s) => {
            const meta = SETTING_META[s.key] ?? { label: s.key, description: "" };
            const isToggling = toggling.has(s.key);
            return (
              <div
                key={s.key}
                className="flex items-start gap-4 rounded-xl border border-border bg-card px-5 py-4"
              >
                <button
                  className="mt-0.5 shrink-0 disabled:opacity-50"
                  onClick={() => void toggle(s.key, s.value)}
                  disabled={isToggling}
                  aria-label={s.value ? `Disable ${meta.label}` : `Enable ${meta.label}`}
                >
                  {isToggling ? (
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  ) : s.value ? (
                    <ToggleRight className="h-7 w-7 text-primary" />
                  ) : (
                    <ToggleLeft className="h-7 w-7 text-muted-foreground" />
                  )}
                </button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-normal text-foreground">{meta.label}</span>
                    <span
                      className={[
                        "rounded px-1.5 py-0.5 font-mono text-[12px] uppercase tracking-wide",
                        s.value
                          ? "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      {s.value ? "on" : "off"}
                    </span>
                    <span className="font-mono text-[12px] text-muted-foreground/60">
                      {s.source === "env" ? "env default" : "db"}
                    </span>
                  </div>
                  {meta.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
                  )}
                  {s.updatedAt && (
                    <p className="mt-1 font-mono text-[12px] text-muted-foreground/60">
                      Last changed {new Date(s.updatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page export ───────────────────────────────────────────────────────────

export default function AdminSettings() {
  const { token, saveToken, clearToken } = useAdminToken();
  if (!token) return <TokenGate onSave={saveToken} />;
  return <SettingsPanel token={token} onClearToken={clearToken} />;
}
