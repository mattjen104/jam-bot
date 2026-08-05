/**
 * Renders a stylized moon-phase SVG that updates daily.
 *
 * The phase is computed client-side from the Julian date using a reference
 * new moon (2000-01-06 18:14 UTC) and the mean synodic period of 29.53 days.
 *
 * The SVG uses a lune-construction technique:
 *   • A base circle filled in the lit colour
 *   • A shadow path (semicircle + ellipse) punch-out using the app background colour
 * This keeps the shadow "transparent" against whatever sits behind the glyph.
 */

const LUNAR_CYCLE = 29.530588853; // mean synodic period, days
const REFERENCE_NM = Date.UTC(2000, 0, 6, 18, 14, 0); // Jan 6 2000 18:14 UTC (known new moon)

/** Returns phase fraction 0–1 (0 = new moon, 0.5 = full moon). */
function moonFraction(date: Date): number {
  const elapsed = date.getTime() - REFERENCE_NM;
  const days = elapsed / 86_400_000;
  const age = ((days % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE;
  return age / LUNAR_CYCLE;
}

/**
 * Builds the SVG path string for the dark shadow region.
 * Returns null at full moon (no shadow), a full-circle path at new moon.
 *
 * Lune geometry:
 *   - Waxing (0 < f < 0.5): left semicircle + closing ellipse (rx shrinks 0→f=0.25, then regrows)
 *   - Waning (0.5 < f < 1): right semicircle + closing ellipse (same logic mirrored)
 *
 * The ellipse x-radius is |r · cos(f · 2π)|; cos gives the right in-out rhythm
 * automatically, and the sweep flag is toggled to pick the correct arc direction.
 */
function shadowPath(f: number, r: number, cx: number, cy: number): string | null {
  if (f < 0.015 || f > 0.985) {
    // New moon — full dark circle (two 180° arcs)
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy + r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z`;
  }
  if (f > 0.485 && f < 0.515) {
    // Full moon — no shadow at all
    return null;
  }

  const ex = r * Math.cos(f * 2 * Math.PI);
  const absEx = Math.abs(ex);
  const top = `${cx} ${cy - r}`;
  const bot = `${cx} ${cy + r}`;
  const isWaxing = f < 0.5;

  if (isWaxing) {
    // Shadow on left: left-arc (sweep=0) + closing ellipse
    // When ex ≥ 0 ellipse continues counter-clockwise (same direction), bulging right → covers more
    // When ex < 0 ellipse reverses clockwise → retreats to left crescent only
    const eSweep = ex >= 0 ? 0 : 1;
    return `M ${top} A ${r} ${r} 0 0 0 ${bot} A ${absEx} ${r} 0 0 ${eSweep} ${top} Z`;
  } else {
    // Shadow on right: right-arc (sweep=1) + closing ellipse (mirrored)
    const eSweep = ex >= 0 ? 1 : 0;
    return `M ${top} A ${r} ${r} 0 0 1 ${bot} A ${absEx} ${r} 0 0 ${eSweep} ${top} Z`;
  }
}

interface MoonPhaseGlyphProps {
  /** Diameter in px — should match the cap-height of the surrounding text. */
  size?: number;
  /** Override date (defaults to today; useful for testing). */
  date?: Date;
}

export function MoonPhaseGlyph({ size = 15, date }: MoonPhaseGlyphProps) {
  const today = date ?? new Date();
  const f = moonFraction(today);
  const r = (size - 2) / 2; // 1px breathing room all around
  const cx = size / 2;
  const cy = size / 2;
  const shadow = shadowPath(f, r, cx, cy);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className="moon-glyph"
    >
      {/* Lit body */}
      <circle cx={cx} cy={cy} r={r} className="moon-glyph__lit" />
      {/* Shadow punch-out */}
      {shadow && <path d={shadow} className="moon-glyph__shadow" />}
      {/* Thin outer ring for crispness */}
      <circle cx={cx} cy={cy} r={r} className="moon-glyph__ring" />
    </svg>
  );
}
