import { useMemo } from "react";
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
} from "./hooks";

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
        aria-label="Album lore"
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

        {/* Provenance */}
        {hasProvenance && (
          <div style={{ padding: "14px 18px", borderBottom: "0.5px solid var(--wp-border)" }}>
            <p
              className="wp-mono"
              style={{ margin: "0 0 10px", fontSize: 12, color: "var(--wp-text-muted)" }}
            >
              PROVENANCE
            </p>
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
          </div>
        )}

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
