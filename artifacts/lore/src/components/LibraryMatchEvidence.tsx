import type { LibraryMatchEvidence as MatchEvidence } from "../lib/libraryMatchEvidence";

export function LibraryMatchEvidence({
  facts,
  onRemove,
}: {
  facts: readonly MatchEvidence[];
  onRemove?: (fact: MatchEvidence) => void;
}) {
  if (facts.length === 0) return null;

  return (
    <div className="library-match-evidence">
      <span>Matches · </span>
      {facts.map((fact, index) => (
        <span key={`${fact.kind}:${fact.value}`}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {onRemove ? (
            <button
              type="button"
              className="library-match-evidence__remove"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(fact);
              }}
              aria-label={`Remove ${fact.label} filter`}
              title={`Remove ${fact.label} filter`}
            >
              {fact.label}<span aria-hidden="true"> ×</span>
            </button>
          ) : fact.label}
        </span>
      ))}
    </div>
  );
}