import { useEffect, useState } from "react";

interface HandoffPreview {
  ownerLabel: string;
  workspaceId: string;
  channelId: string;
  expiresAt: string;
}
interface SharedGrant {
  id: number;
  ownerLabel: string;
  workspaceId: string;
  channelId: string;
  createdAt: string;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export default function SharedLibrary() {
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<HandoffPreview | null>(null);
  const [grants, setGrants] = useState<SharedGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshGrants = async () => {
    const response = await fetch("/api/me/jambot-sharing", { credentials: "include" });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json() as { grants: SharedGrant[] };
    setGrants(Array.isArray(data.grants) ? data.grants : []);
  };

  useEffect(() => {
    // Handoff secrets live only in the fragment, and the fragment is removed
    // synchronously before any request or other asynchronous work starts.
    const fragment = window.location.hash.slice(1);
    if (fragment) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      setToken(fragment);
      setBusy(true);
      void fetch("/api/me/jambot-sharing/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: fragment }),
      }).then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        setPreview(await response.json() as HandoffPreview);
      }).catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not verify the pairing request");
      }).finally(() => setBusy(false));
    }
    void refreshGrants().catch((err: unknown) => {
      setError((current) => current ?? (err instanceof Error ? err.message : "Could not load sharing status"));
    });
  }, []);

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/me/jambot-sharing/claim", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setToken(null);
      setPreview(null);
      setNotice("Your Lore library is now shared with this Slack channel.");
      await refreshGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not confirm this pairing");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (grantId: number) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/me/jambot-sharing/${grantId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice("Lore sharing has been revoked.");
      await refreshGrants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke sharing");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-12 text-foreground">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Lore · shared library</p>
        <h1 className="font-serif text-3xl font-normal">Share crossings with JamBot</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          JamBot can check whether a station’s currently confirmed track appears in your Lore library.
          Your library rows, journal, and Lore session cookie are never sent to Slack.
        </p>

        {error && <p role="alert" className="mt-5 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="mt-5 rounded-lg bg-primary/10 p-3 text-sm">{notice}</p>}

        {busy && !preview && token && <p className="mt-6 text-sm text-muted-foreground">Checking this one-time pairing link…</p>}
        {preview && token && (
          <section className="mt-7 rounded-xl border border-border p-5">
            <h2 className="font-medium">Confirm sharing your library?</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div><dt className="text-muted-foreground">Slack library owner</dt><dd className="font-medium">{preview.ownerLabel}</dd></div>
              <div><dt className="text-muted-foreground">Workspace</dt><dd>{preview.workspaceId}</dd></div>
              <div><dt className="text-muted-foreground">Channel scope</dt><dd>{preview.channelId}</dd></div>
            </dl>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              This grants JamBot access only to minimal current-crossing results in this channel.
              You can revoke access here at any time. The handoff expires {new Date(preview.expiresAt).toLocaleString()}.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
              className="mt-5 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Confirm and share"}
            </button>
          </section>
        )}

        {!token && (
          <section className="mt-7">
            <h2 className="font-medium">Active channel grants</h2>
            {grants.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No Lore libraries are currently shared from this session.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {grants.map((grant) => (
                  <li key={grant.id} className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="font-medium">{grant.ownerLabel} · {grant.channelId}</p>
                      <p className="mt-1 text-muted-foreground">Workspace {grant.workspaceId}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void revoke(grant.id)}
                      className="w-fit rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Revoke access
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}