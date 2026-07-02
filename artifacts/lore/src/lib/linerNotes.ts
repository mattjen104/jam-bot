import type { Credit, TrackKnowledge } from "@workspace/api-client-react";

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
