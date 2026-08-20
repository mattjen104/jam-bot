import { ageDistribution, AGE_DISTRIBUTION_TIERS, type AgeDistribution } from "../../lib/dialAgeDistribution";
import type { AgeTier } from "../../lib/dialAgeFilter";

export function AgeDistributionBadge({
  samples,
  distribution,
  label = "Track age distribution",
}: {
  samples?: ReadonlyArray<{ ageTier?: AgeTier | null }>;
  distribution?: AgeDistribution;
  label?: string;
}) {
  const data = distribution ?? ageDistribution(samples ?? []);
  const slices = AGE_DISTRIBUTION_TIERS.filter(({ tier }) => data.counts[tier] > 0);
  const { stops, cursor } = slices.reduce(
    (result, { tier, color }) => {
      const next = result.cursor + (data.counts[tier] / Math.max(1, data.total)) * 100;
      result.stops.push(`${color} ${result.cursor}% ${next}%`);
      return { stops: result.stops, cursor: next };
    },
    { stops: [] as string[], cursor: 0 },
  );
  if (data.unknown > 0) stops.push(`hsl(var(--muted-foreground) / .55) ${cursor}% 100%`);
  const background = stops.length ? `conic-gradient(${stops.join(", ")})` : "hsl(var(--muted-foreground) / .25)";
  return (
    <span
      className="dial-age-badge"
      role="img"
      tabIndex={0}
      aria-label={`${label}: ${data.detail}`}
      title={data.detail}
      style={{ background }}
    >
      <span className="dial-age-badge__hole" aria-hidden="true" />
      <span className="sr-only">{data.detail}</span>
    </span>
  );
}