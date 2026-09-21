import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import {
  creditIdentityHref,
  creditDiscoveryHref,
  groupCredits,
  type CreditFact,
  type CreditPayload,
} from "../lib/creditPayload";
import { appendReturnState } from "../lib/returnState";

const GROUP_LABELS: Record<string, string> = {
  performers: "Performers & instruments",
  writing: "Writing & composition",
  production: "Production",
  engineering: "Engineering, mix & mastering",
  release: "Release & label",
};

function statusCopy(payload: CreditPayload): string | null {
  if (payload.status === "pending") return "Credits are still being verified.";
  if (payload.status === "deferred") return "Credit verification is deferred until its source is available.";
  if (payload.status === "unavailable" || payload.status === "failed") return "Credit verification is currently unavailable.";
  if (payload.status === "partial" || payload.completeness === "partial") {
    return "Partial verified coverage — missing facts are not treated as “no credits”.";
  }
  return null;
}

function provenanceCopy(payload: CreditPayload): string | null {
  const bits: string[] = [];
  if (payload.source) bits.push(`Source: ${payload.source}`);
  if (payload.parserVersion) bits.push(`parser ${payload.parserVersion}`);
  if (payload.fetchedAt != null) {
    const date = typeof payload.fetchedAt === "number"
      ? new Date(payload.fetchedAt).toLocaleDateString()
      : new Date(payload.fetchedAt).toLocaleDateString();
    if (date !== "Invalid Date") bits.push(`checked ${date}`);
  }
  if (payload.stale) bits.push("may be stale");
  return bits.length ? bits.join(" · ") : null;
}

function CreditName({ fact, returnTo }: { fact: CreditFact; returnTo?: string | null }) {
  const href = fact.identity && !fact.approximate ? creditIdentityHref(fact.identity) : null;
  const name = href ? (
    <Link href={appendReturnState(href, returnTo)} className="credit-fact__link">{fact.name}</Link>
  ) : (
    <span className="credit-fact__text">
      {fact.name}
      {fact.approximate ? <span className="credit-fact__approx">approximate</span> : null}
    </span>
  );
  return (
    <>
      {name}
      {fact.work ? (
        <span className="credit-fact__meta">
          {" · for "}
          {!fact.approximate && creditIdentityHref(fact.work) ? (
            <Link
              href={appendReturnState(creditIdentityHref(fact.work)!, returnTo)}
              className="credit-fact__link"
            >
              {fact.work.name}
            </Link>
          ) : fact.work.name}
        </span>
      ) : null}
    </>
  );
}

function CreditRole({
  fact,
  returnTo,
}: {
  fact: CreditFact;
  returnTo?: string | null;
}) {
  return (
    <Link
      href={appendReturnState(creditDiscoveryHref({ role: fact.role }), returnTo)}
      className="credit-fact__link credit-fact__role"
      aria-label={`Explore ${fact.role} credits`}
    >
      {fact.role}
    </Link>
  );
}

const ROLE_SUMMARY_LABELS: Record<string, string> = {
  producer: "Produced by",
  writer: "Written by",
  composer: "Composed by",
  engineer: "Engineered by",
  mixer: "Mixed by",
  mastering: "Mastered by",
  performer: "Performed by",
  musician: "Performed by",
};

function normalizedRole(role: string): string {
  return role.toLowerCase().trim().replace(/\s+/g, " ");
}

function roleSummaryLabel(role: string): string {
  const normalized = normalizedRole(role);
  return ROLE_SUMMARY_LABELS[normalized]
    ?? `${role.trim().charAt(0).toUpperCase()}${role.trim().slice(1)} by`;
}

function InlineCreditNames({ facts, returnTo }: { facts: CreditFact[]; returnTo?: string | null }) {
  return (
    <>
      {facts.map((fact, index) => (
        <span key={`${fact.role}-${fact.name}-${index}`}>
          {index > 0 ? (index === facts.length - 1 ? " and " : ", ") : null}
          <CreditName fact={fact} returnTo={returnTo} />
        </span>
      ))}
    </>
  );
}

export function CreditSummary({ payload, returnTo }: { payload: CreditPayload; returnTo?: string | null }) {
  const roleLines = [...payload.credits]
    .sort((a, b) => {
      const priority = (group: CreditFact["group"]) =>
        group === "production" ? 0 : group === "engineering" ? 1 : group === "writing" ? 2 : group === "performers" ? 3 : 4;
      return priority(a.group) - priority(b.group);
    })
    .reduce<Array<{ role: string; facts: CreditFact[] }>>((lines, fact) => {
      const key = normalizedRole(fact.role);
      const line = lines.find((candidate) => normalizedRole(candidate.role) === key);
      if (line) line.facts.push(fact);
      else lines.push({ role: fact.role, facts: [fact] });
      return lines;
    }, [])
    .slice(0, 4);
  if (!roleLines.length && !payload.labels.length) return null;
  return (
    <div className="credit-summary" data-testid="credit-summary">
      {roleLines.map((line) => (
        <span key={normalizedRole(line.role)} className="credit-summary__fact" data-testid="credit-summary-role-line">
          <Link
            href={appendReturnState(creditDiscoveryHref({ role: line.role }), returnTo)}
            className="credit-summary__role credit-fact__link"
            aria-label={`Explore ${line.role} credits`}
          >
            {roleSummaryLabel(line.role)}
          </Link>{" "}
          <InlineCreditNames facts={line.facts} returnTo={returnTo} />
        </span>
      ))}
      {payload.labels.slice(0, 1).map((label) => {
        const href = label.kind === "label" && label.labelId && !label.approximate
          ? creditDiscoveryHref({ labelMbid: label.labelId })
          : null;
        return (
          <span key={`label-${label.name}`} className="credit-summary__fact">
            <span className="credit-summary__role">{label.kind}</span>{" "}
            {href ? <Link href={appendReturnState(href, returnTo)} className="credit-fact__link">{label.name}</Link> : (
              <span className="credit-fact__text">{label.name}{label.approximate ? <span className="credit-fact__approx">approximate</span> : null}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function CreditsDisclosure({
  payload,
  title = "Credits & release",
  returnTo,
  open = false,
}: {
  payload: CreditPayload;
  title?: string;
  returnTo?: string | null;
  open?: boolean;
}) {
  if (payload.status === "missing") return null;
  if (!payload.credits.length && !payload.labels.length) {
    return (
      <p className="credits-disclosure__status" role="status">
        {statusCopy(payload) ?? "Credit enrichment is temporarily unavailable."}
      </p>
    );
  }
  return (
    <details className="credits-disclosure" data-testid="credits-disclosure" open={open}>
      <summary>{title}</summary>
      <div className="credits-disclosure__body">
        {statusCopy(payload) && (
          <p className="credits-disclosure__status" role="status">
            {statusCopy(payload)}
          </p>
        )}
        {groupCredits(payload.credits).map(([group, facts]) => (
          <section key={group} className="credits-disclosure__group">
            <h3>
              <Link
                href={appendReturnState(creditDiscoveryHref({ roleGroup: group }), returnTo)}
                className="credit-fact__link"
                aria-label={`Explore ${GROUP_LABELS[group]} credits`}
              >
                {GROUP_LABELS[group]}
              </Link>
            </h3>
            <ul>
              {facts.map((fact, index) => (
                <li key={`${fact.role}-${fact.name}-${index}`}>
                  <CreditRole fact={fact} returnTo={returnTo} />
                  <CreditName fact={fact} returnTo={returnTo} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {payload.labels.length > 0 && (
          <section className="credits-disclosure__group">
            <h3>Release & label</h3>
            <ul>
              {payload.labels.map((label) => {
                const href = label.kind === "label" && label.labelId && !label.approximate
                  ? creditDiscoveryHref({ labelMbid: label.labelId })
                  : null;
                return (
                  <li key={`${label.name}-${label.releaseId ?? ""}`}>
                    <span className="credit-fact__role">{label.kind}</span>
                    {href ? <Link href={appendReturnState(href, returnTo)} className="credit-fact__link">{label.name}</Link> : (
                      <span className="credit-fact__text">{label.name}{label.approximate ? <span className="credit-fact__approx">approximate</span> : null}</span>
                    )}
                    <span className="credit-fact__meta">
                      {label.releaseGroupId ? (
                        <Link
                          href={appendReturnState(`/album/${encodeURIComponent(label.releaseGroupId)}`, returnTo)}
                          className="credit-fact__link"
                        >
                          {label.releaseTitle ?? "album"}
                        </Link>
                      ) : label.releaseTitle ? ` · ${label.releaseTitle}` : null}
                      {label.releaseId ? (
                        <>
                          {" · "}
                          <a
                            href={`https://musicbrainz.org/release/${encodeURIComponent(label.releaseId)}`}
                            target="_blank"
                            rel="noreferrer"
                            title="Canonical release identity"
                            className="credit-fact__link"
                          >
                            edition {label.releaseId.slice(0, 8)}
                          </a>
                        </>
                      ) : null}
                      {label.releaseDate ? ` · ${label.releaseDate}` : label.year ? ` · ${label.year}` : ""}
                      {label.releaseStatus ? ` · ${label.releaseStatus}` : ""}
                      {label.country ? ` · ${label.country}` : ""}
                      {label.catalogNumber ? ` · cat. ${label.catalogNumber}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {payload.source && (
          <p className="credits-disclosure__source">
            <ExternalLink aria-hidden="true" /> {provenanceCopy(payload)}
          </p>
        )}
        {!payload.source && provenanceCopy(payload) && (
          <p className="credits-disclosure__source" role="status">{provenanceCopy(payload)}</p>
        )}
      </div>
    </details>
  );
}

export function KeptCreditSurface({
  kept,
  payload,
  returnTo,
  label = "Credits",
  testId = "kept-credit-surface",
  album = false,
}: {
  kept: boolean;
  payload: CreditPayload;
  returnTo?: string | null;
  label?: string;
  testId?: string;
  album?: boolean;
}) {
  if (!kept) return null;
  return (
    <section className={album ? "album-credits" : "song-credits"} aria-label={label} data-testid={testId}>
      <CreditSummary payload={payload} returnTo={returnTo} />
      {album ? (
        <AlbumCreditsDisclosure payload={payload} returnTo={returnTo} />
      ) : (
        <CreditsDisclosure payload={payload} returnTo={returnTo} />
      )}
    </section>
  );
}

export function AlbumCreditsDisclosure({ payload, returnTo }: { payload: CreditPayload; returnTo?: string | null }) {
  if (payload.status === "missing") return null;
  if (!payload.credits.length && !payload.labels.length && !payload.trackCredits) {
    return <CreditsDisclosure payload={payload} returnTo={returnTo} />;
  }
  const tracks = Object.entries(payload.trackCredits ?? {});
  return (
    <details className="credits-disclosure credits-disclosure--album" data-testid="album-credits-disclosure">
      <summary>Credits & release</summary>
      <div className="credits-disclosure__body">
        {(payload.credits.length > 0 || payload.labels.length > 0) && (
          <CreditsDisclosure payload={payload} title="Album release facts" returnTo={returnTo} open />
        )}
        {tracks.length > 0 && (
          <section className="credits-disclosure__tracks">
            <h3>Per-track credits</h3>
            {tracks.map(([mbid, trackPayload]) => (
              <details key={mbid} className="credits-disclosure__track">
                <summary>{payload.trackTitles?.[mbid] ?? mbid}</summary>
                <CreditsDisclosure payload={trackPayload} title="Track credits" returnTo={returnTo} open />
              </details>
            ))}
          </section>
        )}
      </div>
    </details>
  );
}