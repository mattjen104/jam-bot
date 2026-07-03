import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useListAllDraftClaims,
  getListAllDraftClaimsQueryKey,
  type AllDraftClaim,
} from "@workspace/api-client-react";
import { useAdminToken } from "../hooks/useAdminToken";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  KeyRound,
  Loader2,
  X,
} from "lucide-react";

export default function AdminClaims() {
  const { token, saveToken, clearToken } = useAdminToken();

  if (!token) {
    return <TokenGate onSave={saveToken} />;
  }

  return <ClaimsReview token={token} onClearToken={clearToken} />;
}

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [draft, setDraft] = useState("");

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
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
    </div>
  );
}

function ClaimsReview({
  token,
  onClearToken,
}: {
  token: string;
  onClearToken: () => void;
}) {
  const queryClient = useQueryClient();
  const adminHeaders = { headers: { "x-admin-token": token } };

  const {
    data,
    isLoading,
    isError,
    refetch,
  } = useListAllDraftClaims(
    { status: "draft" },
    { request: adminHeaders },
  );

  const { mutateAsync: patchClaim } = useMutation({
    mutationFn: async ({
      id,
      status,
      text,
    }: {
      id: number;
      status: "published" | "rejected";
      text?: string;
    }) => {
      const res = await fetch(`/api/admin/claims/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ status, ...(text ? { text } : {}) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      return res.json();
    },
  });

  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [paraphrases, setParaphrases] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [errors, setErrors] = useState<Record<number, string>>({});

  const visible = (data?.claims ?? []).filter((c) => !dismissed.has(c.id));

  function dismiss(id: number) {
    setDismissed((prev) => new Set([...prev, id]));
  }

  async function handleAction(
    claim: AllDraftClaim,
    action: "published" | "rejected",
  ) {
    if (action === "published" && !paraphrases[claim.id]?.trim()) {
      setErrors((prev) => ({
        ...prev,
        [claim.id]: "Write a paraphrase before publishing.",
      }));
      return;
    }
    setBusy((prev) => new Set([...prev, claim.id]));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[claim.id];
      return next;
    });
    try {
      await patchClaim({
        id: claim.id,
        status: action,
        ...(action === "published"
          ? { text: paraphrases[claim.id].trim() }
          : {}),
      });
      void queryClient.invalidateQueries({
        queryKey: getListAllDraftClaimsQueryKey({ status: "draft" }),
      });
      dismiss(claim.id);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Request failed — try again.";
      setErrors((prev) => ({ ...prev, [claim.id]: msg }));
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(claim.id);
        return next;
      });
    }
  }

  return (
    <div className="lore-grain relative min-h-screen">
      <div className="lore-glow pointer-events-none absolute inset-0" />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
              Admin
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold text-foreground">
              Wikipedia drafts
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

        {isLoading && (
          <div className="mt-12 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading drafts…</span>
          </div>
        )}

        {isError && (
          <div className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
            <p className="text-sm text-destructive-foreground">
              Could not load drafts. Check the admin token or server.
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

        {!isLoading && !isError && visible.length === 0 && (
          <div className="mt-12 rounded-2xl border border-card-border bg-card p-8 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <p className="mt-4 font-serif text-lg text-foreground">
              No pending drafts
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              All Wikipedia claims have been reviewed.
            </p>
          </div>
        )}

        {visible.length > 0 && (
          <p className="mt-4 font-mono text-[11px] text-muted-foreground/70">
            {visible.length} draft{visible.length === 1 ? "" : "s"} pending
          </p>
        )}

        <ul className="mt-4 flex flex-col gap-4">
          {visible.map((claim) => (
            <li
              key={claim.id}
              className="rounded-2xl border border-card-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-[11px] uppercase tracking-wide text-primary">
                    {claim.anchorValue || "—"}
                  </p>
                  <p className="mt-1 truncate font-medium text-foreground">
                    {claim.trackTitle ?? claim.mbid}
                    {claim.trackArtist && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        — {claim.trackArtist}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                    {claim.sourceLabel}
                  </p>
                </div>
                <a
                  href={claim.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70 hover:text-primary"
                >
                  <BookOpen className="h-3 w-3" />
                  Wikipedia
                  <ArrowUpRight className="h-3 w-3" />
                </a>
              </div>

              <textarea
                rows={3}
                placeholder="Write a paraphrase of the key fact from this Wikipedia section…"
                value={paraphrases[claim.id] ?? ""}
                onChange={(e) =>
                  setParaphrases((prev) => ({
                    ...prev,
                    [claim.id]: e.target.value,
                  }))
                }
                className="mt-4 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />

              {errors[claim.id] && (
                <p className="mt-1.5 text-xs text-destructive-foreground">
                  {errors[claim.id]}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy.has(claim.id)}
                  onClick={() => void handleAction(claim, "published")}
                  className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground shadow-sm transition-opacity disabled:opacity-50"
                >
                  {busy.has(claim.id) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Publish
                </button>
                <button
                  type="button"
                  disabled={busy.has(claim.id)}
                  onClick={() => void handleAction(claim, "rejected")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
