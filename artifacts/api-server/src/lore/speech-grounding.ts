import { eligibleDjName, normalizeAttributionName } from "@workspace/lore-attribution";

export interface TimestampedTranscriptSegment {
  startedAtMs: number;
  endedAtMs: number;
  text: string;
}

export type SpeechClaimKind = "dj" | "show" | "topic";

export interface GroundedSpeechClaim {
  kind: SpeechClaimKind;
  value: string;
  segmentIndex: number;
  /** Claim timing must be contained by the cited transcript segment. */
  startedAtMs: number;
  endedAtMs: number;
  startChar: number;
  endChar: number;
}

/** Validate an exact, bounded supporting text span (not a model paraphrase). */
export function validateSupportingSpan(
  segments: readonly TimestampedTranscriptSegment[],
  claim: GroundedSpeechClaim,
): boolean {
  const segment = segments[claim.segmentIndex];
  if (!segment || !Number.isInteger(claim.startChar) || !Number.isInteger(claim.endChar)) return false;
  if (claim.startedAtMs < segment.startedAtMs || claim.endedAtMs > segment.endedAtMs ||
    claim.endedAtMs < claim.startedAtMs) return false;
  const text = segment.text;
  if (claim.startChar < 0 || claim.endChar > text.length || claim.startChar >= claim.endChar) return false;
  return normalizeAttributionName(text.slice(claim.startChar, claim.endChar)) ===
    normalizeAttributionName(claim.value);
}

/** DJ claims have the shared attribution eligibility rule in addition to span proof. */
export function validateGroundedClaim(
  segments: readonly TimestampedTranscriptSegment[],
  claim: GroundedSpeechClaim,
): boolean {
  if (!validateSupportingSpan(segments, claim)) return false;
  return claim.kind !== "dj" || eligibleDjName(claim.value) !== null;
}

/**
 * Intentionally small, deterministic extraction vocabulary.  Each value is an
 * exact substring of a single ASR segment; this is evidence collection, not
 * attribution and never uses a generative model.
 */
export function extractExplicitGroundedClaims(
  segments: readonly TimestampedTranscriptSegment[],
): GroundedSpeechClaim[] {
  const claims: GroundedSpeechClaim[] = [];
  const patterns: Array<{ kind: SpeechClaimKind; expression: RegExp }> = [
    { kind: "dj", expression: /\b(?:this is|i'?m|your host is)\s+((?:DJ\s+)?[A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*){0,2})\b/giu },
    { kind: "show", expression: /\b(?:you(?:'re| are) listening to|this is)\s+([A-Z][\p{L}0-9&' -]{1,60})\s+(?:show|radio)\b/giu },
    { kind: "topic", expression: /\b(?:today(?:'s)? topic is|we(?:'re| are) talking about)\s+([A-Za-z][A-Za-z0-9 &'-]{1,80})\b/giu },
  ];
  segments.forEach((segment, segmentIndex) => {
    for (const { kind, expression } of patterns) {
      expression.lastIndex = 0;
      for (const match of segment.text.matchAll(expression)) {
        const value = match[1]?.trim();
        const offset = (match.index ?? -1) + (match[0].indexOf(match[1] ?? ""));
        if (!value || offset < 0) continue;
        const claim: GroundedSpeechClaim = {
          kind, value, segmentIndex, startedAtMs: segment.startedAtMs,
          endedAtMs: segment.endedAtMs, startChar: offset, endChar: offset + value.length,
        };
        if (validateGroundedClaim(segments, claim)) claims.push(claim);
      }
    }
  });
  return claims;
}