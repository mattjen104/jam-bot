import type { AgeTier } from "./dialAgeFilter";

export const AGE_DISTRIBUTION_TIERS = [
  { tier: "first", label: "Premiere", color: "hsl(28 92% 62%)" },
  { tier: "current", label: "Current", color: "hsl(146 58% 52%)" },
  { tier: "catalog", label: "Catalog", color: "hsl(198 72% 62%)" },
  { tier: "deep", label: "Deep", color: "hsl(270 42% 67%)" },
] as const;

export type AgeDistribution = {
  counts: Record<AgeTier, number>;
  unknown: number;
  total: number;
  label: string;
  detail: string;
};

export function ageDistribution(
  samples: ReadonlyArray<{ ageTier?: AgeTier | null }>,
): AgeDistribution {
  const counts: Record<AgeTier, number> = { first: 0, current: 0, catalog: 0, deep: 0 };
  let unknown = 0;
  for (const sample of samples) {
    if (sample.ageTier == null) unknown += 1;
    else counts[sample.ageTier] += 1;
  }
  const total = samples.length;
  const parts = AGE_DISTRIBUTION_TIERS
    .filter(({ tier }) => counts[tier] > 0)
    .map(({ tier, label }) => `${label} ${counts[tier]}`);
  if (unknown > 0) parts.push(`Unknown ${unknown}`);
  return {
    counts,
    unknown,
    total,
    label: total === 0 ? "No track-age data" : parts.join(" · "),
    detail: total === 0
      ? "No track-age data is available."
      : `${total} track${total === 1 ? "" : "s"} sampled: ${parts.join(", ")}.`,
  };
}