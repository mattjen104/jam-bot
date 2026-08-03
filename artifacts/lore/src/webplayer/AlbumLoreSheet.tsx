import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Disc3,
  ListMusic,
  User,
  Check,
  FileText,
  Headphones,
  Video,
  ScrollText,
  ExternalLink,
  X,
} from "lucide-react";
import {
  useWpRecording,
  useWpKnowledge,
  useWpListProvenance,
  useWpPicks,
  useWpRecordingSpins,
  useWpSongExploder,
  useWpLoreCounts,
  useWpSupport,
  useWpHoldSupport,
  useWpUnholdSupport,
} from "./hooks";
import { WpKeep } from "./WpKeep";

/** Defensive readers for the loosely-typed knowledge payload. */
function readPressing(k: Record<string, unknown> | undefined): {
  year: number | null;
  label: string | null;
} {
  const knowledge = (k?.knowledge ?? null) as Record<string, unknown> | null;
  const pressing = (knowledge?.pressing ?? null) as Record<string, unknown> | null;
  const year =
    typeof pressing?.year === "number"
      ? pressing.year
      : typeof pressing?.releaseYear === "number"
        ? (pressing.releaseYear as number)
        : null;
  const label = typeof pressing?.label === "string" ? pressing.label : null;
  return { year, label };
}

function readClaims(
  k: Record<string, unknown> | undefined,
): Array<{ id: number; text: string; sourceUrl: string | null; sourceLabel: string | null }> {
  const claims = k?.claims;
  if (!Array.isArray(claims)) return [];
  return claims
    .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
    .map((c, i) => ({
      id: typeof c.id === "number" ? c.id : i,
      text: typeof c.text === "string" ? c.text : "",
      sourceUrl: typeof c.sourceUrl === "string" ? c.sourceUrl : null,
      sourceLabel: typeof c.sourceLabel === "string" ? c.sourceLabel : null,
    }))
    .filter((c) => c.text.length > 0);
}

function GoDeeperRow({
  href,
  icon,
  title,
  subtitle,
  tag,
  last,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tag: string;
  last?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        textDecoration: "none",
        color: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: last ? "none" : "0.5px solid var(--wp-border)",
      }}
    >
      <span style={{ color: "var(--wp-text-secondary)", flexShrink: 0, display: "flex" }}>
        {icon}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{title}</span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            fontSize: 12,
            color: "var(--wp-text-secondary)",
          }}
        >
          {subtitle}
        </span>
      </span>
      <span
        className="wp-mono"
        style={{
          fontSize: 11,
          color: "var(--wp-text-muted)",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {tag} <ExternalLink size={12} aria-hidden="true" />
      </span>
    </a>
  );
}

function isSafeSupportHref(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function supportLabel(kind: string): string {
  switch (kind) {
    case "artist":
      return "Support the artist";
    case "bandcamp":
      return "Buy direct on Bandcamp";
    case "label":
      return "Support the label";
    case "station":
      return "Support the station";
    case "discogs":
      return "Find this release on Discogs";
    default:
      return "Open support link";
  }
}

function paidToLine(paidTo: string): string {
  switch (paidTo) {
    case "artist":
      return "Paid to the artist";
    case "artist_and_label":
      return "Paid to the artist and label";
    case "label":
      return "Paid to the label";
    case "station":
      return "Paid to the station";
    case "seller":
      return "Paid to the seller";
    default:
      return "";
  }
}

function supportNote(link: {
  kind: string;
  paidTo: string;
  note: string | null;
  attribution: string | null;
}): string {
  if (link.kind === "station") return "Because you heard it here.";
  if (link.kind === "discogs") return "Artist is not paid.";
  return link.note ?? link.attribution ?? paidToLine(link.paidTo);
}

function formatFriday(date: string): string {
  return date;
}

function SupportRow({
  link,
  bandcampFriday,
  held,
  onToggleHold,
  holdPending,
}: {
  link: {
    kind: string;
    tier: number;
    paidTo: string;
    url: string;
    detail: string;
    note: string | null;
    attribution: string | null;
  };
  bandcampFriday: { eligible: boolean; date: string };
  held: boolean;
  onToggleHold?: () => void;
  holdPending?: boolean;
}) {
  if (!isSafeSupportHref(link.url)) return null;
  const isDiscogs = link.kind === "discogs";
  const isDirect = link.kind === "artist" || link.kind === "bandcamp";
  const fridayNote =
    link.kind === "bandcamp" && bandcampFriday.eligible
      ? `fees waived Fri ${formatFriday(bandcampFriday.date)}`
      : null;

  return (
    <div
      className={`wp-support-row${isDiscogs ? " is-secondary" : ""}`}
      data-emphasis={isDirect ? "strong" : undefined}
      data-testid={`support-row-${link.kind}`}
    >
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="wp-support-link"
        aria-label={`${supportLabel(link.kind)}: ${link.detail}`}
      >
        <span className="wp-support-copy">
          <span className="wp-support-title">{supportLabel(link.kind)}</span>
          <span className="wp-support-detail">{link.detail}</span>
          <span className="wp-support-note">
            {fridayNote ?? supportNote(link)}
          </span>
        </span>
      </a>
      {link.kind === "bandcamp" && bandcampFriday.eligible && onToggleHold && (
        <button
          type="button"
          className="wp-support-hold"
          aria-pressed={held}
          disabled={holdPending}
          onClick={onToggleHold}
          data-testid="support-hold-button"
        >
          {held ? `Held for ${formatFriday(bandcampFriday.date)}` : "Hold"}
        </button>
      )}
    </div>
  );
}

function SupportSection({
  mbid,
  supportQuery,
}: {
  mbid: string;
  supportQuery: ReturnType<typeof useWpSupport>;
}) {
  const queryClient = useQueryClient();
  const holdMutation = useWpHoldSupport();
  const unholdMutation = useWpUnholdSupport();
  const [held, setHeld] = useState(false);
  const [holdError, setHoldError] = useState(false);

  useEffect(() => {
    if (supportQuery.data) setHeld(supportQuery.data.held);
  }, [supportQuery.data]);

  const support = supportQuery.data;
  const links = [...(support?.links ?? [])]
    .filter((link) => isSafeSupportHref(link.url))
    .sort((a, b) => a.tier - b.tier || (a.kind === "discogs" ? 1 : 0) - (b.kind === "discogs" ? 1 : 0));
  const bandcamp = support?.bandcampFriday ?? { eligible: false, date: "" };
  const bandcampLink = links.find((link) => link.kind === "bandcamp");
  const holdPending = holdMutation.isPending || unholdMutation.isPending;

  const toggleHold = () => {
    if (holdPending) return;
    setHoldError(false);
    const previous = held;
    const next = !previous;
    setHeld(next);
    const mutation = next ? holdMutation : unholdMutation;
    mutation.mutate(
      { mbid },
      {
        onSuccess: (result) => {
          setHeld(result.held);
          void queryClient.invalidateQueries({
            queryKey: [`/api/recordings/${mbid}/support`],
          });
        },
        onError: () => {
          setHeld(previous);
          setHoldError(true);
        },
      },
    );
  };

  return (
    <section
      className="wp-support-section"
      aria-labelledby="wp-support-heading"
      data-testid="track-support"
    >
      <div className="wp-support-heading-row">
        <h2 id="wp-support-heading" className="wp-mono">
          Support
        </h2>
        <span className="wp-support-heading-note">who gets paid</span>
      </div>

      {supportQuery.isLoading && (
        <p className="wp-support-status" data-testid="support-loading">
          Loading support options…
        </p>
      )}

      {supportQuery.isError && (
        <div className="wp-support-status" data-testid="support-error">
          <span>Support options unavailable right now.</span>{" "}
          <button type="button" onClick={() => void supportQuery.refetch()}>
            Try again
          </button>
        </div>
      )}

      {!supportQuery.isLoading && !supportQuery.isError && support && links.length === 0 && (
        <p className="wp-support-status" data-testid="support-empty">
          {support.emptyMessage ?? "No linkable release found."}
        </p>
      )}

      {!supportQuery.isLoading && !supportQuery.isError && support && links.length > 0 && (
        <div className="wp-support-ladder">
          {links.map((link) => (
            <SupportRow
              key={`${link.kind}:${link.url}`}
              link={link}
              bandcampFriday={bandcamp}
              held={held}
              holdPending={holdPending}
              onToggleHold={
                link === bandcampLink && bandcamp.eligible ? toggleHold : undefined
              }
            />
          ))}
        </div>
      )}

      {holdError && (
        <p className="wp-support-status wp-support-error" data-testid="support-hold-error">
          Hold could not be changed. Try again.
        </p>
      )}
    </section>
  );
}

/**
 * Album lore panel — bottom sheet with provenance pills and typed GO DEEPER
 * rows, composed from existing recording endpoints. Everything is honest:
 * sections render only when real data exists.
 */
export function AlbumLoreSheet({
  mbid,
  spinningOn,
  onClose,
}: {
  mbid: string;
  spinningOn?: string | null;
  onClose: () => void;
}) {
  const { data: rec } = useWpRecording(mbid);
  const { data: knowledge } = useWpKnowledge(mbid);
  const { data: provenance } = useWpListProvenance(mbid);
  const { data: picks } = useWpPicks(mbid);
  const { data: spins } = useWpRecordingSpins(mbid);
  const { data: se } = useWpSongExploder(mbid);
  const { data: counts } = useWpLoreCounts([mbid]);
  const supportQuery = useWpSupport(mbid);
  const [justKept, setJustKept] = useState(false);

  const pressing = readPressing(knowledge);
  const claims = readClaims(knowledge);
  const count = counts?.get(mbid);

  // "Low Tide · spun 4x" — group broadcast spins by selector (dj or show name).
  const selectorPills = useMemo(() => {
    const byName = new Map<string, number>();
    for (const s of spins?.spins ?? []) {
      const name = s.show?.djName ?? s.show?.name;
      if (!name) continue;
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    return [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [spins]);

  const listPills = (provenance?.items ?? []).slice(0, 3);
  const pickPills = (picks?.picks ?? [])
    .filter((p) => p.listTitle != null)
    .slice(0, 2);

  const headerMeta = [
    pressing.year != null ? String(pressing.year) : null,
    pressing.label,
  ]
    .filter(Boolean)
    .join(" · ");

  const artifactTotal = count ? count.artifactCount + count.listCount : 0;
  const hasProvenance =
    listPills.length > 0 || selectorPills.length > 0 || pickPills.length > 0 || count?.keptSince;

  // GO DEEPER rows, typed by medium.
  const readRows = claims.filter((c) => c.sourceUrl).slice(0, 3);

  return (
    <>
      <div className="wp-sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="wp wp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Track details"
        style={{ padding: 0 }}
        data-testid="album-lore-sheet"
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "0.5px solid var(--wp-border)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          {rec?.artworkUrl ? (
            <img
              src={rec.artworkUrl}
              alt=""
              style={{ width: 52, height: 52, borderRadius: "var(--wp-radius)", objectFit: "cover", flexShrink: 0 }}
            />
          ) : (
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: "var(--wp-radius)",
                background: "var(--wp-bg-accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Disc3 size={24} style={{ color: "var(--wp-text-accent)" }} aria-hidden="true" />
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>
              {rec ? `${rec.title} · ${rec.artist}` : "Loading…"}
            </p>
            {(headerMeta || spinningOn) && (
              <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--wp-text-secondary)" }}>
                {headerMeta}
                {spinningOn && (
                  <>
                    {headerMeta && <span style={{ color: "var(--wp-text-muted)" }}> · </span>}
                    <span style={{ color: "var(--wp-text-muted)" }}>spinning now on </span>
                    {spinningOn}
                  </>
                )}
              </p>
            )}
          </div>
          {artifactTotal > 0 && (
            <span
              className="wp-pill"
              style={{
                background: "var(--wp-bg-pro)",
                color: "var(--wp-text-pro)",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <ScrollText size={13} aria-hidden="true" /> {artifactTotal}{" "}
              {artifactTotal === 1 ? "artifact" : "artifacts"}
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ padding: 6, borderRadius: "50%", display: "flex" }}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        {/* Provenance — stays above the keep action and support ladder. */}
        <section
          className="wp-track-provenance"
          aria-labelledby="wp-provenance-heading"
          data-testid="track-provenance"
        >
            <p
              className="wp-mono"
              style={{ margin: "0 0 10px", fontSize: 12, color: "var(--wp-text-muted)" }}
              id="wp-provenance-heading"
            >
              PROVENANCE
            </p>
            {hasProvenance ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {listPills.map((l) => (
                <span
                  key={`list-${l.listId}`}
                  style={{
                    fontSize: 13,
                    padding: "5px 11px",
                    border: "0.5px solid var(--wp-border-strong)",
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <ListMusic size={13} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
                  {l.sourceName}: {l.listTitle}
                  {l.rank != null && l.isRanked ? ` · #${l.rank}` : ""}
                </span>
              ))}
              {pickPills.map((p, i) => (
                <span
                  key={`pick-${i}`}
                  style={{
                    fontSize: 13,
                    padding: "5px 11px",
                    border: "0.5px solid var(--wp-border-strong)",
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <User size={13} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
                  {p.picker.name} · {p.listTitle}
                </span>
              ))}
              {selectorPills.map(([name, n]) => (
                <span
                  key={`sel-${name}`}
                  style={{
                    fontSize: 13,
                    padding: "5px 11px",
                    border: "0.5px solid var(--wp-border-strong)",
                    borderRadius: 999,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <User size={13} style={{ color: "var(--wp-text-muted)" }} aria-hidden="true" />
                  {name} · spun {n}x
                </span>
              ))}
              {count?.keptSince && (
                <span
                  style={{
                    fontSize: 13,
                    padding: "5px 11px",
                    border: "0.5px solid var(--wp-border-strong)",
                    borderRadius: 999,
                    color: "var(--wp-text-success)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                  }}
                >
                  <Check size={13} aria-hidden="true" />
                  in your library since {new Date(count.keptSince).getFullYear()}
                </span>
              )}
            </div>
            ) : (
              <p className="wp-provenance-empty">No broadcast or list provenance recorded.</p>
            )}
        </section>

        {/* Keep remains the single existing library action. */}
        <section className="wp-track-keep" aria-label="Keep this track">
          <WpKeep
            mbid={rec?.mbid ?? mbid}
            provenance={{ kind: "keep", stationName: spinningOn ?? undefined }}
            onSuccess={() => setJustKept(true)}
          />
          {justKept && supportQuery.data?.links.some((link) => link.kind === "artist" || link.kind === "bandcamp") && (
            <p className="wp-keep-follow-up" data-testid="keep-follow-up">
              Direct artist support is available below.
            </p>
          )}
        </section>

        <SupportSection mbid={mbid} supportQuery={supportQuery} />

        {/* GO DEEPER */}
        <div style={{ padding: "14px 18px 16px" }}>
          <p
            className="wp-mono"
            style={{ margin: "0 0 10px", fontSize: 12, color: "var(--wp-text-muted)" }}
          >
            GO DEEPER
          </p>

          {readRows.map((c, i) => (
            <GoDeeperRow
              key={c.id}
              href={c.sourceUrl!}
              icon={<FileText size={18} aria-hidden="true" />}
              title={c.text.length > 80 ? `${c.text.slice(0, 77)}…` : c.text}
              subtitle={c.sourceLabel ?? "Source"}
              tag="READ"
              last={
                i === readRows.length - 1 && !se?.episode && true /* credits row follows */ && false
              }
            />
          ))}

          {se?.episode && (
            <GoDeeperRow
              href={se.episode.episodeUrl}
              icon={<Headphones size={18} aria-hidden="true" />}
              title={se.episode.title}
              subtitle="Song Exploder · the song, taken apart in the artist's words"
              tag="LISTEN"
            />
          )}

          {se?.episode?.youtubeUrl && (
            <GoDeeperRow
              href={se.episode.youtubeUrl}
              icon={<Video size={18} aria-hidden="true" />}
              title={`${se.episode.title} — video`}
              subtitle="Song Exploder on YouTube"
              tag="WATCH"
            />
          )}

          <GoDeeperRow
            href={`https://musicbrainz.org/recording/${mbid}`}
            icon={<ScrollText size={18} aria-hidden="true" />}
            title="Liner notes and credits"
            subtitle="Full personnel and release credits · via MusicBrainz"
            tag="CREDITS"
            last
          />
        </div>
      </div>
    </>
  );
}
