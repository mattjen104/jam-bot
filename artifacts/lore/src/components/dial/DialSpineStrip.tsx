/**
 * DialSpineStrip — a narrow vertical strip of 5 kept-track album-cover
 * "spines" lining the left edge of the Dial sidebar.
 *
 * Purely decorative: no labels, no tap affordance, no roles.
 * Each spine fills one-fifth of the sidebar height with the track artwork
 * as a background-image (object-fit cover). Falls back to the ambient
 * background colour when an artwork URL is absent.
 */

export interface DialSpineStripProps {
  /** Up to 5 artwork URLs; nulls render as dark fallback panels. */
  urls: (string | null)[];
}

const SPINE_COUNT = 5;

export function DialSpineStrip({ urls }: DialSpineStripProps) {
  const slots = Array.from({ length: SPINE_COUNT }, (_, i) => urls[i] ?? null);

  return (
    <aside className="dial-spine-strip" aria-hidden="true">
      {slots.map((url, i) => (
        <div
          key={i}
          className="dial-spine-strip__pane"
          style={url ? { backgroundImage: `url(${url})` } : undefined}
        />
      ))}
    </aside>
  );
}
