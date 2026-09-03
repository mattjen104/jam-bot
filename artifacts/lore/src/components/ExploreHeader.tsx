interface ExploreHeaderProps {
  title: string;
  description: string;
  liveCount: number;
  crossingCount: number;
  radioMode: boolean;
  onOpenScan: () => void;
  onToggleCrossings: () => void;
}

/**
 * Explore's front door: a short orientation layer above the live station
 * surface. The actions deliberately map to existing, reliable behaviors:
 * Scan opens the guided scanner and the second action changes the station
 * scope without creating a new playback path.
 */
export function ExploreHeader({
  title,
  description,
  liveCount,
  crossingCount,
  radioMode,
  onOpenScan,
  onToggleCrossings,
}: ExploreHeaderProps) {
  const crossingLabel = `${crossingCount} crossing${crossingCount === 1 ? "" : "s"}`;
  const liveLabel = `${liveCount} room${liveCount === 1 ? "" : "s"} live`;

  return (
    <header className="explore-header" data-testid="explore-header">
      <div className="explore-header__copy">
        <p className="explore-header__eyebrow">Explore · live radio</p>
        <h1 className="explore-header__title">{title}</h1>
        <p className="explore-header__description">{description}</p>
      </div>

      <div className="explore-header__controls" role="group" aria-label="Explore actions">
        <button
          type="button"
          className="explore-header__action explore-header__action--primary"
          onClick={onOpenScan}
        >
          Scan live
        </button>
        <button
          type="button"
          className="explore-header__action"
          aria-pressed={!radioMode}
          onClick={onToggleCrossings}
        >
          {radioMode ? "Show crossings" : "Show all rooms"}
        </button>
      </div>

      <div className="explore-header__stats" aria-label="Explore status">
        <span>{liveLabel}</span>
        <span aria-hidden="true">·</span>
        <span>{crossingLabel}</span>
      </div>
    </header>
  );
}

export function ExploreSectionHeader({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div className="explore-section__header">
      <div>
        <h2 className="explore-section__title">{title}</h2>
        <p className="explore-section__description">{description}</p>
      </div>
      <span className="explore-section__count">{count}</span>
    </div>
  );
}