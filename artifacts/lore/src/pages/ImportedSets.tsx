import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateImportedSet,
  useDeleteImportedSet,
  useGetImportedSet,
  useListImportedSets,
  getListImportedSetsQueryKey,
  getGetImportedSetQueryKey,
  type ImportedSet,
  type ImportedSetEntry,
} from "@workspace/api-client-react";
import { usePlayer, type RideSeed } from "../player/PlayerProvider";

const MAX_BYTES = 1_048_576;

/** Honest, distinct labels per resolution basis — a title match must never
 *  look as certain as an MBID match. */
function basisLabel(entry: ImportedSetEntry): { label: string; tone: "strong" | "medium" | "weak" | "none" } {
  if (entry.resolutionStatus === "pending") return { label: "RESOLVING…", tone: "none" };
  if (entry.resolutionStatus === "unresolved") {
    const reason =
      entry.unresolvedReason === "no_identifiers"
        ? "NOTHING TO MATCH ON"
        : entry.unresolvedReason === "resolver_error"
          ? "LOOKUP FAILED"
          : "NO MATCH FOUND";
    return { label: reason, tone: "none" };
  }
  switch (entry.resolutionBasis) {
    case "lore_mbid":
      return { label: "LORE MBID", tone: "strong" };
    case "mbid":
      return { label: "MBID", tone: "strong" };
    case "isrc":
      return { label: "ISRC", tone: "medium" };
    case "spotify":
      return { label: "SERVICE MATCH", tone: "weak" };
    default:
      return { label: "TITLE MATCH", tone: "weak" };
  }
}

const TONE_CLASS: Record<string, string> = {
  strong: "border-primary-border text-primary",
  medium: "border-card-border text-foreground",
  weak: "border-card-border text-muted-foreground",
  none: "border-transparent text-muted-foreground",
};

function EntryRow({ entry }: { entry: ImportedSetEntry }) {
  const { label, tone } = basisLabel(entry);
  const resolved = entry.resolutionStatus === "resolved" && entry.recording;
  const title = resolved ? entry.recording!.title : entry.title ?? "(untitled)";
  const artist = resolved ? entry.recording!.artist : entry.creator ?? "(unknown artist)";
  return (
    <li
      data-testid={`imported-entry-${entry.position}`}
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        resolved ? "border-card-border bg-card" : "border-dashed border-card-border bg-transparent"
      }`}
    >
      <span className="w-7 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {entry.position + 1}
      </span>
      {resolved && entry.recording!.artworkUrl ? (
        <img
          src={entry.recording!.artworkUrl}
          alt=""
          className="h-9 w-9 shrink-0 rounded object-cover"
        />
      ) : (
        <span className="h-9 w-9 shrink-0 rounded bg-muted/40" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{artist}</span>
      </span>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONE_CLASS[tone]}`}
        title={
          entry.resolutionStatus === "unresolved"
            ? "This slot stays visible; playback skips it."
            : undefined
        }
      >
        {label}
      </span>
    </li>
  );
}

function SetDetail({ setId }: { setId: number }) {
  const { ride } = usePlayer();
  const { data: set } = useGetImportedSet(setId, {
    query: {
      queryKey: getGetImportedSetQueryKey(setId),
      refetchInterval: (query) =>
        query.state.data?.status === "resolving" ? 2_000 : false,
    },
  });
  if (!set) return null;
  const entries = set.entries ?? [];
  const playable = entries.filter(
    (e) => e.resolutionStatus === "resolved" && e.recording != null,
  );
  const skipped = entries.length - playable.length;

  const play = () => {
    const seeds: RideSeed[] = playable.map((e) => ({
      mbid: e.recording!.mbid,
      title: e.recording!.title,
      artist: e.recording!.artist,
      artworkUrl: e.recording!.artworkUrl ?? null,
      links: e.recording!.links ?? [],
      ...(e.durationMs != null ? { spinDurationSeconds: Math.round(e.durationMs / 1000) } : {}),
    }));
    ride.startReplay(seeds, set.citation, { timeOrientation: "curated" });
  };

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[12px] uppercase tracking-wider text-muted-foreground">
            {set.citation}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {set.resolvedCount}/{set.trackCount} resolved
            {set.status === "resolving" ? " — still resolving, play what's ready" : ""}
            {skipped > 0 && set.status !== "resolving"
              ? ` — ${skipped} ${skipped === 1 ? "slot" : "slots"} will be skipped (shown below with a reason)`
              : ""}
          </div>
        </div>
        <button
          type="button"
          data-testid="play-imported-set"
          onClick={play}
          disabled={playable.length === 0}
          className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-40"
        >
          Play {playable.length > 0 ? `(${playable.length})` : ""}
        </button>
      </div>
      <ol className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <EntryRow key={entry.position} entry={entry} />
        ))}
      </ol>
    </div>
  );
}

export default function ImportedSets() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [openSetId, setOpenSetId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data: list } = useListImportedSets();
  const create = useCreateImportedSet({
    mutation: {
      onSuccess: (set) => {
        setUploadError(null);
        setOpenSetId(set.id);
        void qc.invalidateQueries({ queryKey: getListImportedSetsQueryKey() });
      },
      onError: (err) => {
        const message =
          (err as { body?: { error?: string } })?.body?.error ??
          (err instanceof Error ? err.message : "Import failed");
        setUploadError(message);
      },
    },
  });
  const remove = useDeleteImportedSet({
    mutation: {
      onSuccess: (_data, vars) => {
        if (openSetId === vars.id) setOpenSetId(null);
        void qc.invalidateQueries({ queryKey: getListImportedSetsQueryKey() });
        void qc.removeQueries({ queryKey: getGetImportedSetQueryKey(vars.id) });
      },
    },
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setUploadError("That file is over the 1 MB import limit.");
      return;
    }
    const content = await file.text();
    create.mutate({ data: { filename: file.name, content } });
  };

  const sets = list?.sets ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-mono text-lg uppercase tracking-wider text-foreground">
        Imported Sets
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Load an XSPF or JSPF playlist — from Lore or any other tool — and play
        it here. Imported sets are yours alone: they never touch the radio
        archive, crossings, or listener counts.
      </p>

      <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xspf,.jspf,.json,.xml"
          className="hidden"
          data-testid="imported-set-file-input"
          onChange={(e) => {
            void onFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          data-testid="imported-set-upload"
          onClick={() => fileRef.current?.click()}
          disabled={create.isPending}
          className="hover-elevate inline-flex items-center gap-2 rounded-full border border-primary-border bg-primary px-5 py-2.5 font-mono text-sm uppercase tracking-wide text-primary-foreground disabled:opacity-40"
        >
          {create.isPending ? "Importing…" : "Choose a playlist file"}
        </button>
        <div className="mt-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          XSPF or JSPF · up to 1 MB · up to 500 tracks
        </div>
        {uploadError && (
          <div
            data-testid="imported-set-error"
            className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {uploadError}
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        {sets.length === 0 && (
          <div className="text-sm text-muted-foreground">No imported sets yet.</div>
        )}
        {sets.map((set: ImportedSet) => (
          <div key={set.id} className="rounded-xl border border-card-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                data-testid={`imported-set-${set.id}`}
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpenSetId(openSetId === set.id ? null : set.id)}
              >
                <span className="block truncate text-sm text-foreground">{set.name}</span>
                <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  IMPORTED · {set.sourceFilename} · {set.resolvedCount}/{set.trackCount}
                  {set.status === "resolving" ? " · resolving" : ""}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${set.name}`}
                onClick={() => remove.mutate({ id: set.id })}
                className="shrink-0 rounded-full border border-card-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover-elevate"
              >
                Remove
              </button>
            </div>
            {openSetId === set.id && <SetDetail setId={set.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
