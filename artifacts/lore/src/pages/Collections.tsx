import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getListOwnedCollectionsQueryKey,
  useListOwnedCollections,
  useUpdateCollection,
  useWithdrawCollection,
  type ManagedLoreCollection,
} from "@workspace/api-client-react";

function CollectionEditor({ collection }: { collection: ManagedLoreCollection }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(collection.title);
  const [description, setDescription] = useState(collection.description ?? "");
  const [curatorNotes, setCuratorNotes] = useState(collection.curatorNotes ?? "");
  const [entries, setEntries] = useState(collection.entries);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: getListOwnedCollectionsQueryKey() });
  const update = useUpdateCollection({ mutation: { onSuccess: refresh } });
  const withdraw = useWithdrawCollection({ mutation: { onSuccess: refresh } });
  const save = () => update.mutate({
    slug: collection.slug,
    data: {
      kind: collection.kind,
      title,
      description: description || null,
      curatorNotes: curatorNotes || null,
      coverArt: collection.coverArt,
      entries,
    },
  });
  const moveEntry = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= entries.length) return;
    setEntries((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };
  return <article className="rounded-2xl bg-card p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{collection.published ? "Public" : "Withdrawn"}</p>
        <Link href={`/collection/${collection.slug}`} className="mt-1 block text-sm text-primary underline">/collection/{collection.slug}</Link>
      </div>
      <span className="text-xs text-muted-foreground">{collection.entries.length} entries</span>
    </div>
    <label className="mt-4 block text-xs text-muted-foreground">Title
      <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-lg bg-background px-3 py-2 text-foreground" />
    </label>
    <label className="mt-3 block text-xs text-muted-foreground">Description
      <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg bg-background px-3 py-2 text-foreground" />
    </label>
    <label className="mt-3 block text-xs text-muted-foreground">Curator notes
      <textarea value={curatorNotes} onChange={(event) => setCuratorNotes(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg bg-background px-3 py-2 text-foreground" />
    </label>
    <div className="mt-4">
      <p className="text-xs text-muted-foreground">Ordered entries</p>
      <ol className="mt-2 space-y-2">{entries.map((entry, index) => {
        const item = entry as { title?: string; artist?: string; unavailableReason?: string };
        return <li key={`${index}-${item.title ?? "entry"}`} className="flex items-center gap-2 rounded-lg bg-background px-3 py-2">
          <span className="w-6 font-mono text-xs text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{item.title ?? "Unavailable entry"}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.artist ?? item.unavailableReason ?? "Unknown artist"}</span>
          </span>
          <button type="button" aria-label={`Move ${item.title ?? "entry"} up`} disabled={index === 0} onClick={() => moveEntry(index, -1)} className="px-2 text-muted-foreground disabled:opacity-25">↑</button>
          <button type="button" aria-label={`Move ${item.title ?? "entry"} down`} disabled={index === entries.length - 1} onClick={() => moveEntry(index, 1)} className="px-2 text-muted-foreground disabled:opacity-25">↓</button>
          <button type="button" aria-label={`Remove ${item.title ?? "entry"}`} onClick={() => setEntries((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="px-2 text-muted-foreground">Remove</button>
        </li>;
      })}</ol>
    </div>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" disabled={!title.trim() || update.isPending} onClick={save} className="rounded-full bg-primary px-4 py-2 font-mono text-xs uppercase text-primary-foreground disabled:opacity-40">
        {collection.published ? "Save changes" : "Update and republish"}
      </button>
      {collection.published && <button type="button" disabled={withdraw.isPending} onClick={() => {
        if (window.confirm("Withdraw this collection? Its link will show a permanent tombstone until you republish it.")) {
          withdraw.mutate({ slug: collection.slug });
        }
      }} className="rounded-full bg-muted px-4 py-2 font-mono text-xs uppercase text-muted-foreground disabled:opacity-40">Withdraw</button>}
    </div>
    {(update.isError || withdraw.isError) && <p role="alert" className="mt-3 text-sm text-destructive">The change could not be saved. Only the collection owner can manage this page.</p>}
  </article>;
}

export default function Collections() {
  const { data, isLoading, isError } = useListOwnedCollections();
  return <main className="mx-auto max-w-2xl px-4 py-8 pb-24">
    <Link href="/" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">← Lore</Link>
    <h1 className="mt-8 font-serif text-4xl text-foreground">Published collections</h1>
    <p className="mt-2 text-sm text-muted-foreground">Update public notes or withdraw a page. Withdrawn links stay reserved and show a tombstone until you republish.</p>
    {isLoading && <p className="mt-8 text-muted-foreground">Loading collections…</p>}
    {isError && <p className="mt-8 text-destructive">Your collections could not be loaded.</p>}
    {data?.length === 0 && <p className="mt-8 text-muted-foreground">You have not published a collection from this device.</p>}
    <div className="mt-8 space-y-4">{data?.map((collection) => <CollectionEditor key={collection.slug} collection={collection} />)}</div>
  </main>;
}