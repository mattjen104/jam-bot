import type { HomeLens } from "../lib/homeLensState";

export function HomeLensNav({
  activeLens,
  onSelect,
  showArchiveLenses = false,
}: {
  activeLens: HomeLens;
  onSelect: (lens: HomeLens) => void;
  showArchiveLenses?: boolean;
}) {
  return (
    <nav className="home-discovery__lens-nav" aria-label="Home sections">
      <button
        type="button"
        className={`home-discovery__lens-link${activeLens === "radio" ? " home-discovery__lens-link--active" : ""}`}
        aria-pressed={activeLens === "radio"}
        onClick={() => onSelect("radio")}
      >
        On the air
      </button>
      {showArchiveLenses ? (
        <>
          <span aria-hidden="true">|</span>
          <button
            type="button"
            className={`home-discovery__lens-link${activeLens === "firstPlays" ? " home-discovery__lens-link--active" : ""}`}
            aria-pressed={activeLens === "firstPlays"}
            onClick={() => onSelect("firstPlays")}
          >
            First plays
          </button>
          <span aria-hidden="true">|</span>
          <button
            type="button"
            className={`home-discovery__lens-link${activeLens === "press" ? " home-discovery__lens-link--active" : ""}`}
            aria-pressed={activeLens === "press"}
            onClick={() => onSelect("press")}
          >
            Press
          </button>
        </>
      ) : null}
    </nav>
  );
}