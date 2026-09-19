import { useState } from "react";
import { Link } from "wouter";
import {
  ApiError,
  getListOwnedCollectionsQueryKey,
  useCreateCollection,
  useUpdateCollection,
  type CreateLoreCollection,
  type LoreCollection,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export function collectionSlugSuggestion(title: string, suffix = "") {
  const base = title.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "collection";
  return `${base}${suffix ? `-${suffix}` : ""}`.slice(0, 80);
}

type PublishInput = CreateLoreCollection & {
  onPublished?: (collection: LoreCollection) => void;
};

/** Small, deliberately boring publisher. The server is authoritative for slug collisions. */
export function PublishCollectionButton({ onPublished, ...input }: PublishInput) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<LoreCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collision, setCollision] = useState<{ owned: boolean; suggestedSlug?: string } | null>(null);
  const published = (collection: LoreCollection) => {
    setResult(collection);
    setError(null);
    setCollision(null);
    void queryClient.invalidateQueries({ queryKey: getListOwnedCollectionsQueryKey() });
    onPublished?.(collection);
  };
  const create = useCreateCollection({
    mutation: {
      onSuccess: published,
      onError: (err) => {
        const detail = err instanceof ApiError
          ? err.data as { code?: string; error?: string; suggestedSlug?: string } | null
          : null;
        setCollision(detail?.code === "COLLECTION_OWNED"
          ? { owned: true }
          : detail?.code === "SLUG_TAKEN"
            ? { owned: false, suggestedSlug: detail.suggestedSlug }
            : null);
        setError(detail?.error ?? (err instanceof Error ? err.message : "Couldn't publish this collection."));
      },
    },
  });
  const update = useUpdateCollection({ mutation: { onSuccess: published } });
  const pending = create.isPending || update.isPending;
  const updateExisting = () => update.mutate({
    slug: input.slug,
    data: {
      kind: input.kind,
      title: input.title,
      description: input.description,
      curatorNotes: input.curatorNotes,
      coverArt: input.coverArt,
      entries: input.entries,
    },
  });
  return (
    <div className="mt-4">
      <button type="button" disabled={pending} onClick={() => {
        setError(null);
        setCollision(null);
        create.mutate({ data: input });
      }} className="hover-elevate rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-xs uppercase tracking-wider text-primary-foreground disabled:opacity-40">
        {pending ? "Publishing…" : "Publish publicly"}
      </button>
      {result && <p className="mt-2 text-sm text-primary">Published — <Link className="underline" href={`/collection/${result.slug}`}>view the public page</Link></p>}
      {error && <div role="alert" className="mt-2 text-sm text-destructive">
        <p>{error}</p>
        {collision?.owned && <button type="button" onClick={updateExisting} className="mt-2 underline">Update and republish the existing page</button>}
        {collision && !collision.owned && collision.suggestedSlug && (
          <button type="button" onClick={() => create.mutate({ data: { ...input, slug: collision.suggestedSlug! } })} className="mt-2 underline">
            Publish as {collision.suggestedSlug}
          </button>
        )}
      </div>}
      <p className="mt-2 text-xs text-muted-foreground"><Link className="underline" href="/collections">Manage published collections</Link></p>
    </div>
  );
}