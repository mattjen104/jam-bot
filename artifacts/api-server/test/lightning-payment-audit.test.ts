import { describe, expect, it } from "vitest";
import {
  normalizeAuditArtist,
  validateReviewedPaymentEvidence,
  type ReviewedPaymentEvidence,
} from "../src/lore/lightning-payment-audit.js";

const valid: ReviewedPaymentEvidence = {
  subjectKind: "artist",
  recipient: "Example Artist",
  canonicalId: "64dad611-8ada-4696-ac5f-ecb8bf73d51b",
  mechanism: "lightning_address",
  destination: "Artist@Example.com",
  evidenceUrl: "https://example.com/pay",
  identityEvidenceUrl: "https://musicbrainz.org/artist/64dad611-8ada-4696-ac5f-ecb8bf73d51b",
  confidence: "verified_canonical",
  verifiedAt: "2026-09-18T00:00:00.000Z",
  provenance: "official site linked by canonical artist record",
};

describe("Lightning payment audit gates", () => {
  it("normalizes artist labels consistently", () => {
    expect(normalizeAuditArtist("  Björk & Friends! ")).toBe("björk friends");
  });

  it("accepts a canonical artist with a well-formed Lightning address", () => {
    const result = validateReviewedPaymentEvidence(valid, new Date("2026-09-19"));
    expect(result.reason).toBeNull();
    expect(result.evidence?.normalizedDestination).toBe("artist@example.com");
  });

  it("rejects name-only artist matches", () => {
    const result = validateReviewedPaymentEvidence(
      { ...valid, canonicalId: null },
      new Date("2026-09-19"),
    );
    expect(result.reason).toBe("artist_requires_canonical_mbid");
  });

  it("rejects generic pages as malformed direct destinations", () => {
    const result = validateReviewedPaymentEvidence(
      { ...valid, destination: "https://example.com/donate" },
      new Date("2026-09-19"),
    );
    expect(result.reason).toBe("malformed_destination");
  });

  it("does not treat a Nostr public key as a zap payment destination", () => {
    const result = validateReviewedPaymentEvidence(
      {
        ...valid,
        mechanism: "nostr_zap",
        destination:
          "npub1yfg0d955c2jrj2080ew7pa4xrtj7x7s7umt28wh0zurwmxgpyj9shwv6vg",
      },
      new Date("2026-09-19"),
    );
    expect(result.reason).toBe("malformed_destination");
  });
});