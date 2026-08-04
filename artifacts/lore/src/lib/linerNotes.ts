import type { Credit, TrackKnowledge, TrackClaim } from "@workspace/api-client-react";

/** A single fact row inside a liner-notes group. */
export interface LinerRow {
  id: string;
  /** Role label for credit rows (e.g. "Produced by"). */
  label?: string;
  /** The main display text (names, claim sentence, pressing line, rel title). */
  text: string;
  /** Short source chip label shown next to the text. */
  sourceLabel?: string;
  /** External URL to open — renders an ExternalLink icon when present. */
  sourceUrl?: string;
}

/** A named section of liner-notes rows (PRESSING / CREDITS / RELATIONSHIPS / CLAIMS). */
export interface LinerGroup {
  label: string;
  rows: LinerRow[];
}

/**
 * Build grouped liner-notes rows from knowledge + published claims.
 * Returns an empty array when there is nothing to show.
 */
export function buildLinerGroups(
  knowledge: TrackKnowledge | null,
  claims: TrackClaim[],
): LinerGroup[] {
  const groups: LinerGroup[] = [];

  if (knowledge) {
    // ── PRESSING ────────────────────────────────────────────────────────────
    const pressing = pressingLine(knowledge);
    if (pressing) {
      groups.push({
        label: "PRESSING",
        rows: [
          {
            id: "pressing",
            text: pressing,
            sourceLabel: "Discogs",
          },
        ],
      });
    }

    // ── CREDITS ─────────────────────────────────────────────────────────────
    const creditRows = groupCredits(knowledge.personnel);
    if (creditRows.length > 0) {
      groups.push({
        label: "CREDITS",
        rows: creditRows.map((row) => ({
          id: `credit-${row.label}`,
          label: row.label,
          text: row.names,
        })),
      });
    }

    // ── RELATIONSHIPS ────────────────────────────────────────────────────────
    const rels = knowledge.relationships ?? [];
    if (rels.length > 0) {
      groups.push({
        label: "RELATIONSHIPS",
        rows: rels.map((rel) => ({
          id: `rel-${rel.kind}-${rel.targetId}`,
          text: rel.title
            ? `${rel.label} — ${rel.title}${rel.artist ? ` (${rel.artist})` : ""}`
            : rel.label,
          sourceUrl: rel.mbUrl,
        })),
      });
    }
  }

  // ── CLAIMS ────────────────────────────────────────────────────────────────
  const publishedClaims = claims.filter(
    (c) => !c.status || c.status === "published",
  );
  if (publishedClaims.length > 0) {
    groups.push({
      label: "CLAIMS",
      rows: publishedClaims.map((claim, i) => ({
        id: `claim-${i}-${claim.sourceHandle}`,
        text: claim.text,
        sourceLabel: claim.sourceLabel,
        sourceUrl: claim.sourceUrl || undefined,
      })),
    });
  }

  return groups;
}

/** Group raw credits into reader-friendly buckets, mirroring the Slack card. */
export function groupCredits(personnel: Credit[]): Array<{
  label: string;
  names: string;
}> {
  const seen = (list: Credit[], cap = 4): string => {
    const names = [...new Set(list.map((c) => c.name))];
    return names.length <= cap
      ? names.join(", ")
      : `${names.slice(0, cap).join(", ")} +${names.length - cap} more`;
  };
  const lower = (c: Credit) => c.role.toLowerCase();
  const producers = personnel.filter((c) => lower(c).includes("produc"));
  const writers = personnel.filter((c) =>
    ["composer", "lyricist", "writer"].includes(lower(c)),
  );
  const engineers = personnel.filter(
    (c) =>
      lower(c).includes("engineer") ||
      ["mix", "mastering", "recording"].includes(lower(c)),
  );
  const bucketed = new Set([...producers, ...writers, ...engineers]);
  const performers = personnel.filter((c) => !bucketed.has(c));
  const rows: Array<{ label: string; names: string }> = [];
  if (producers.length) rows.push({ label: "Produced by", names: seen(producers) });
  if (writers.length) rows.push({ label: "Written by", names: seen(writers) });
  if (engineers.length) rows.push({ label: "Engineered by", names: seen(engineers) });
  if (performers.length) {
    const byName = new Map<string, string[]>();
    for (const c of performers) {
      const roles = byName.get(c.name) ?? [];
      if (c.role && c.role !== "performer" && !roles.includes(c.role)) {
        roles.push(c.role);
      }
      byName.set(c.name, roles);
    }
    const entries = [...byName.entries()].map(([name, roles]) =>
      roles.length ? `${name} (${roles.join(", ")})` : name,
    );
    rows.push({
      label: "Performed by",
      names:
        entries.length <= 4
          ? entries.join(", ")
          : `${entries.slice(0, 4).join(", ")} +${entries.length - 4} more`,
    });
  }
  return rows;
}

export function pressingLine(k: TrackKnowledge): string | null {
  const p = k.pressing;
  if (!p) return null;
  return (
    [p.label, p.year ? String(p.year) : null, p.country]
      .filter(Boolean)
      .join(" · ") || null
  );
}
