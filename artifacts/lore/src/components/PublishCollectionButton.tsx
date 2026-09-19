import { useState } from "react";
import { Link } from "wouter";
import {
  useCreateCollection,
  type CreateLoreCollection,
  type LoreCollection,
} from "@workspace/api-client-react";

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
  const [result, setResult] = useState<LoreCollection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCollection({
    mutation: {
      onSuccess: (collection) => {
        setResult(collection);
        setError(null);
        onPublished?.(collection);
      },
      onError: (err) =>
        setError(err instanceof Error ? err.message : "Couldn't publish this collection."),
    },
  });
  return (
    <div className="mt-4">
      <button type="button" disabled={create.isPending} onClick={() => {
        setError(null);
        create.mutate({ data: input });
      }} className="hover-elevate rounded-full border border-primary-border bg-primary px-4 py-2 font-mono text-xs uppercase tracking-wider text-primary-foreground disabled:opacity-40">
        {create.isPending ? "Publishing…" : "Publish publicly"}
      </button>
      {result && <p className="mt-2 text-sm text-primary">Published — <Link className="underline" href={`/collection/${result.slug}`}>view the public page</Link></p>}
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}