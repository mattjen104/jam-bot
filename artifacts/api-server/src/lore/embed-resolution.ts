import { db, embedLinkTable, type EmbedLink } from "@workspace/db";
import { and, asc, eq, lte, sql } from "drizzle-orm";

export type { EmbedLink };

export const EMBED_PROVIDERS = ["bandcamp", "youtube"] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];

export const EMBED_ROLES = ["provenance", "control"] as const;
export type EmbedRole = (typeof EMBED_ROLES)[number];

export const EMBED_OUTCOMES = [
  "embedded",
  "link_out",
  "no_link",
  "expired",
  "transient_failure",
] as const;
export type EmbedOutcome = (typeof EMBED_OUTCOMES)[number];

export const EMBED_CONFIDENCES = ["exact", "gated", "none"] as const;
export type EmbedConfidence = (typeof EMBED_CONFIDENCES)[number];

export const EMBED_RESOLUTION_METHODS = [
  "mb-url-rel",
  "page-extract",
  "yt-search",
  "cache",
] as const;
export type EmbedResolutionMethod = (typeof EMBED_RESOLUTION_METHODS)[number];

/** Ladder values are deliberately numeric so lower values are stronger. */
export type EmbedRung = 1 | 2 | 3 | 4 | 5 | 6;

export const EMBED_TTL_MS = {
  bandcamp: 90 * 24 * 60 * 60 * 1000,
  youtube: 14 * 24 * 60 * 60 * 1000,
  durableMiss: 30 * 24 * 60 * 60 * 1000,
  transientFailure: 7 * 24 * 60 * 60 * 1000,
} as const;

export type EmbedResolutionInput = {
  recordingMbid: string;
  provider: EmbedProvider;
  role: EmbedRole;
  rung: EmbedRung;
  outcome: EmbedOutcome;
  releaseMbid?: string | null;
  providerReleaseId?: string | null;
  providerTrackId?: string | null;
  sourceUrl?: string | null;
  resolvedVia: EmbedResolutionMethod;
  confidence: EmbedConfidence;
  reason: string;
  fetchedAt?: Date;
  expiresAt?: Date;
};

export type EmbedResolutionState = EmbedLink & {
  /** Effective state after applying TTL to a persisted positive result. */
  effectiveOutcome: EmbedOutcome;
};

function assertInput(input: EmbedResolutionInput): void {
  if (!input.recordingMbid.trim()) throw new Error("recordingMbid is required");
  if (!EMBED_PROVIDERS.includes(input.provider))
    throw new Error("invalid embed provider");
  if (!EMBED_ROLES.includes(input.role)) throw new Error("invalid embed role");
  if (input.rung < 1 || input.rung > 6)
    throw new Error("embed rung must be 1 through 6");
  if (!input.reason.trim()) throw new Error("embed reason is required");
  if (input.outcome === "embedded" && input.rung > 4) {
    throw new Error("embedded results must be on rung 1 through 4");
  }
  if (input.outcome === "link_out" && input.rung !== 5) {
    throw new Error("link-out results must be rung 5");
  }
  if (input.outcome === "no_link" && input.rung !== 6) {
    throw new Error("no-link results must be rung 6");
  }
}

function ttlFor(
  input: Pick<EmbedResolutionInput, "provider" | "outcome">,
): number {
  if (input.outcome === "transient_failure")
    return EMBED_TTL_MS.transientFailure;
  if (input.outcome === "no_link") return EMBED_TTL_MS.durableMiss;
  return EMBED_TTL_MS[input.provider];
}

export function embedExpiresAt(
  input: Pick<EmbedResolutionInput, "provider" | "outcome">,
  fetchedAt = new Date(),
): Date {
  return new Date(fetchedAt.getTime() + ttlFor(input));
}

export function isEmbedResolutionExpired(
  row: Pick<EmbedLink, "expiresAt">,
  now = new Date(),
): boolean {
  return row.expiresAt.getTime() <= now.getTime();
}

/**
 * Apply TTL without erasing the stored facts. Expiry is a state transition for
 * callers, not a reason to pretend the provider never resolved.
 */
export function effectiveEmbedOutcome(
  row: Pick<EmbedLink, "outcome" | "expiresAt">,
  now = new Date(),
): EmbedOutcome {
  if (
    (row.outcome === "embedded" || row.outcome === "link_out") &&
    isEmbedResolutionExpired(row, now)
  ) {
    return "expired";
  }
  return row.outcome as EmbedOutcome;
}

export function embedIdentity(
  input: Pick<EmbedResolutionInput, "recordingMbid" | "provider" | "role">,
): string {
  return `${input.recordingMbid}\u001f${input.provider}\u001f${input.role}`;
}

function confidenceRank(confidence: string): number {
  return confidence === "exact" ? 3 : confidence === "gated" ? 2 : 1;
}

function isPositive(outcome: string): boolean {
  return outcome === "embedded" || outcome === "link_out";
}

/**
 * Persist one provider/role decision without allowing a weaker result or a
 * transient outage to erase a still-valid stronger result.
 */
export async function upsertEmbedResolution(
  input: EmbedResolutionInput,
): Promise<EmbedLink> {
  assertInput(input);
  const fetchedAt = input.fetchedAt ?? new Date();
  const expiresAt = input.expiresAt ?? embedExpiresAt(input, fetchedAt);
  const identity = embedIdentity(input);

  return db.transaction(async (tx) => {
    // Serialize writers for this identity before reading it. This closes the
    // read-then-write race where a weaker concurrent result could otherwise
    // observe the same stale row and overwrite a stronger result.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identity}))`);
    const [existing] = await tx
      .select()
      .from(embedLinkTable)
      .where(
        and(
          eq(embedLinkTable.recordingMbid, input.recordingMbid),
          eq(embedLinkTable.provider, input.provider),
          eq(embedLinkTable.role, input.role),
        ),
      )
      .limit(1)
      .for("update");

    if (existing) {
      const existingOutcome = effectiveEmbedOutcome(existing, fetchedAt);
      const existingIsFresh = !isEmbedResolutionExpired(existing, fetchedAt);
      const incomingWouldDowngrade =
        isPositive(existingOutcome) &&
        (!isPositive(input.outcome) ||
          existing.rung < input.rung ||
          (existing.rung === input.rung &&
            confidenceRank(existing.confidence) >
              confidenceRank(input.confidence)));

      if (existingIsFresh && incomingWouldDowngrade) {
        return existing;
      }

      const releaseChanged =
        existing.releaseMbid != null &&
        input.releaseMbid != null &&
        existing.releaseMbid !== input.releaseMbid;
      const [updated] = await tx
        .update(embedLinkTable)
        .set({
          rung: input.rung,
          outcome: input.outcome,
          releaseMbid: input.releaseMbid ?? null,
          providerReleaseId: input.providerReleaseId ?? null,
          providerTrackId: input.providerTrackId ?? null,
          sourceUrl: input.sourceUrl ?? null,
          resolvedVia: input.resolvedVia,
          confidence: input.confidence,
          reason: input.reason,
          ...(releaseChanged
            ? {
                previousReleaseMbid: existing.releaseMbid,
                releaseChangedAt: fetchedAt,
              }
            : {}),
          fetchedAt,
          expiresAt,
          updatedAt: fetchedAt,
        })
        .where(eq(embedLinkTable.id, existing.id))
        .returning();
      if (!updated)
        throw new Error(`embed resolution update lost: ${identity}`);
      return updated;
    }

    const [created] = await tx
      .insert(embedLinkTable)
      .values({
        recordingMbid: input.recordingMbid,
        provider: input.provider,
        role: input.role,
        rung: input.rung,
        outcome: input.outcome,
        releaseMbid: input.releaseMbid ?? null,
        providerReleaseId: input.providerReleaseId ?? null,
        providerTrackId: input.providerTrackId ?? null,
        sourceUrl: input.sourceUrl ?? null,
        resolvedVia: input.resolvedVia,
        confidence: input.confidence,
        reason: input.reason,
        fetchedAt,
        expiresAt,
        updatedAt: fetchedAt,
      })
      .returning();
    if (!created)
      throw new Error(`embed resolution insert failed: ${identity}`);
    return created;
  });
}

export async function getEmbedResolution(
  recordingMbid: string,
  provider: EmbedProvider,
  role: EmbedRole,
): Promise<EmbedResolutionState | null> {
  const [row] = await db
    .select()
    .from(embedLinkTable)
    .where(
      and(
        eq(embedLinkTable.recordingMbid, recordingMbid),
        eq(embedLinkTable.provider, provider),
        eq(embedLinkTable.role, role),
      ),
    )
    .limit(1);
  return row ? { ...row, effectiveOutcome: effectiveEmbedOutcome(row) } : null;
}

export async function listEmbedResolutions(
  recordingMbid: string,
): Promise<EmbedResolutionState[]> {
  const rows = await db
    .select()
    .from(embedLinkTable)
    .where(eq(embedLinkTable.recordingMbid, recordingMbid))
    .orderBy(asc(embedLinkTable.provider), asc(embedLinkTable.role));
  return rows.map((row) => ({
    ...row,
    effectiveOutcome: effectiveEmbedOutcome(row),
  }));
}

/** Make expiry explicit when a scheduler has observed an expired row. */
export async function markEmbedResolutionExpired(
  recordingMbid: string,
  provider: EmbedProvider,
  role: EmbedRole,
  now = new Date(),
): Promise<EmbedLink | null> {
  const [row] = await db
    .update(embedLinkTable)
    .set({ outcome: "expired", reason: "ttl_elapsed", updatedAt: now })
    .where(
      and(
        eq(embedLinkTable.recordingMbid, recordingMbid),
        eq(embedLinkTable.provider, provider),
        eq(embedLinkTable.role, role),
        lte(embedLinkTable.expiresAt, now),
      ),
    )
    .returning();
  return row ?? null;
}
