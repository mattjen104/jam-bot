export type PaymentMechanism =
  | "lightning_address"
  | "lnurl_pay"
  | "nostr_zap"
  | "other_lightning";

export type AuditSubjectKind = "artist" | "station";
export type EvidenceConfidence =
  | "verified_canonical"
  | "verified_official"
  | "verified_catalog_recording";

export type ReviewedPaymentEvidence = {
  subjectKind: AuditSubjectKind;
  recipient: string;
  canonicalId?: string | null;
  mechanism: PaymentMechanism;
  destination: string;
  evidenceUrl: string;
  identityEvidenceUrl: string;
  confidence: EvidenceConfidence;
  verifiedAt: string;
  provenance: string;
};

export type ValidatedPaymentEvidence = ReviewedPaymentEvidence & {
  normalizedDestination: string;
};

const MBID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIGHTNING_ADDRESS_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const LNURL_RE = /^lnurl1[02-9ac-hj-np-z]{20,}$/i;

function safeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function validateReviewedPaymentEvidence(
  row: ReviewedPaymentEvidence,
  now = new Date(),
): { evidence: ValidatedPaymentEvidence | null; reason: string | null } {
  if (!row.recipient.trim()) return { evidence: null, reason: "missing_recipient" };
  if (!safeHttpsUrl(row.evidenceUrl) || !safeHttpsUrl(row.identityEvidenceUrl)) {
    return { evidence: null, reason: "unsafe_evidence_url" };
  }
  const verifiedAt = new Date(row.verifiedAt);
  if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt > now) {
    return { evidence: null, reason: "invalid_verification_time" };
  }
  if (
    row.subjectKind === "artist" &&
    (!row.canonicalId || !MBID_RE.test(row.canonicalId))
  ) {
    return { evidence: null, reason: "artist_requires_canonical_mbid" };
  }

  const destination = row.destination.trim();
  let normalizedDestination: string | null = null;
  if (row.mechanism === "lightning_address" && LIGHTNING_ADDRESS_RE.test(destination)) {
    normalizedDestination = destination.toLowerCase();
  } else if (
    row.mechanism === "lnurl_pay" &&
    (LNURL_RE.test(destination) || safeHttpsUrl(destination))
  ) {
    normalizedDestination = destination.toLowerCase();
  } else if (
    row.mechanism === "nostr_zap" &&
    (LNURL_RE.test(destination) || LIGHTNING_ADDRESS_RE.test(destination))
  ) {
    normalizedDestination = destination.toLowerCase();
  } else if (
    row.mechanism === "other_lightning" &&
    safeHttpsUrl(destination)
  ) {
    normalizedDestination = destination;
  }
  if (!normalizedDestination) return { evidence: null, reason: "malformed_destination" };

  return {
    evidence: { ...row, normalizedDestination },
    reason: null,
  };
}

export function normalizeAuditArtist(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100_000) / 1_000;
}