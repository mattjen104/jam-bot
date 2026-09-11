import {
  db,
  recordingReleaseEvidenceTable,
  recordingsTable,
} from "@workspace/db";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

export type ProviderReleaseEvidence = {
  provider: "spotify" | "apple_music";
  providerTrackId: string;
  providerReleaseId?: string | null;
  isrc?: string | null;
  releaseDate: string;
  precision?: "year" | "month" | "day" | null;
  recordingMbid?: string | null;
  observedAt?: Date;
};

export function validateProviderReleaseDate(
  value: string,
  precision?: string | null,
): { releaseDate: string; year: number; precision: "year" | "month" | "day" } | null {
  const trimmed = value.trim();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] == null ? null : Number(match[2]);
  const day = match[3] == null ? null : Number(match[3]);
  if (year < 1000 || year > new Date().getUTCFullYear() + 1) return null;
  if (month != null && (month < 1 || month > 12)) return null;
  if (day != null) {
    if (month == null) return null;
    const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > maxDay) return null;
  }
  const inferred = day != null ? "day" : month != null ? "month" : "year";
  if (precision && precision !== inferred) return null;
  return { releaseDate: trimmed, year, precision: inferred };
}

/**
 * Idempotently retain an exact-provider fact. Provider facts may fill an empty
 * recording date but never advance MusicBrainz checked sentinels.
 */
export async function recordProviderReleaseEvidence(
  evidence: ProviderReleaseEvidence,
): Promise<boolean> {
  const valid = validateProviderReleaseDate(evidence.releaseDate, evidence.precision);
  const providerTrackId = evidence.providerTrackId.trim();
  if (!valid || !providerTrackId) return false;
  const isrc = evidence.isrc?.trim().toUpperCase() || null;
  const mbid = evidence.recordingMbid?.trim() || null;
  const observedAt = evidence.observedAt ?? new Date();

  let accepted = false;
  await db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(recordingReleaseEvidenceTable)
      .values({
        provider: evidence.provider,
        providerTrackId,
        providerReleaseId: evidence.providerReleaseId?.trim() || null,
        isrc,
        releaseDate: valid.releaseDate,
        precision: valid.precision,
        recordingMbid: mbid,
        observedAt,
        linkedAt: mbid ? observedAt : null,
        status: mbid ? "linked" : "provisional",
      })
      .onConflictDoUpdate({
        target: [
          recordingReleaseEvidenceTable.provider,
          recordingReleaseEvidenceTable.providerTrackId,
        ],
        set: {
          providerReleaseId: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${evidence.providerReleaseId?.trim() || null}
            ELSE ${recordingReleaseEvidenceTable.providerReleaseId}
          END`,
          isrc: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${isrc}
            ELSE ${recordingReleaseEvidenceTable.isrc}
          END`,
          releaseDate: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${valid.releaseDate}
            ELSE ${recordingReleaseEvidenceTable.releaseDate}
          END`,
          precision: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${valid.precision}
            ELSE ${recordingReleaseEvidenceTable.precision}
          END`,
          recordingMbid: sql`CASE
            WHEN ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN coalesce(${mbid}, ${recordingReleaseEvidenceTable.recordingMbid})
            ELSE ${recordingReleaseEvidenceTable.recordingMbid}
          END`,
          linkedAt: sql`CASE
            WHEN ${mbid} IS NOT NULL AND (
              ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            ) THEN ${observedAt}
            ELSE ${recordingReleaseEvidenceTable.linkedAt}
          END`,
          status: sql`CASE
            WHEN ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${mbid ? "linked" : "provisional"}
            ELSE ${recordingReleaseEvidenceTable.status}
          END`,
          lastError: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN NULL
            ELSE ${recordingReleaseEvidenceTable.lastError}
          END`,
          observedAt: sql`CASE
            WHEN ${mbid} IS NULL OR ${recordingReleaseEvidenceTable.recordingMbid} IS NULL
              OR ${recordingReleaseEvidenceTable.recordingMbid} = ${mbid}
            THEN ${observedAt}
            ELSE ${recordingReleaseEvidenceTable.observedAt}
          END`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ recordingMbid: recordingReleaseEvidenceTable.recordingMbid });
    accepted = !mbid || stored?.recordingMbid === mbid;
    if (mbid && accepted) {
      await tx
        .update(recordingsTable)
        .set({
          releaseYear: sql`coalesce(${recordingsTable.releaseYear}, ${valid.year})`,
          releaseDate: sql`coalesce(${recordingsTable.releaseDate}, ${valid.releaseDate})`,
          updatedAt: sql`now()`,
        })
        .where(eq(recordingsTable.mbid, mbid));
    }
  });
  return accepted;
}

/** Persist a retryable provider failure without inventing release metadata. */
export async function recordProviderReleaseFailure(args: {
  provider: "spotify" | "apple_music";
  providerTrackId: string;
  error: string;
}): Promise<void> {
  const providerTrackId = args.providerTrackId.trim();
  if (!providerTrackId) return;
  await db
    .insert(recordingReleaseEvidenceTable)
    .values({
      provider: args.provider,
      providerTrackId,
      releaseDate: null,
      precision: "unknown",
      status: "transient_failure",
      lastError: args.error.slice(0, 500),
    })
    .onConflictDoUpdate({
      target: [
        recordingReleaseEvidenceTable.provider,
        recordingReleaseEvidenceTable.providerTrackId,
      ],
      set: {
        status: sql`CASE
          WHEN ${recordingReleaseEvidenceTable.releaseDate} IS NULL
          THEN 'transient_failure'
          ELSE ${recordingReleaseEvidenceTable.status}
        END`,
        lastError: args.error.slice(0, 500),
        observedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/** Link exact provider facts after canonical resolution, requiring matching ISRC. */
export async function reconcileProviderReleaseEvidence(args: {
  recordingMbid: string;
  isrc?: string | null;
}): Promise<number> {
  const isrc = args.isrc?.trim().toUpperCase();
  if (!isrc) return 0;
  const [identity] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(recordingsTable)
    .where(eq(recordingsTable.isrc, isrc));
  // An ISRC can legitimately identify more than one MB recording. Never pick
  // one canonical row when the local spine proves the identity is ambiguous.
  if (identity?.count !== 1) return 0;
  const rows = await db
    .select()
    .from(recordingReleaseEvidenceTable)
    .where(
      and(
        eq(recordingReleaseEvidenceTable.isrc, isrc),
        isNull(recordingReleaseEvidenceTable.recordingMbid),
        isNotNull(recordingReleaseEvidenceTable.releaseDate),
      ),
    );
  for (const row of rows) {
    await recordProviderReleaseEvidence({
      provider: row.provider as "spotify" | "apple_music",
      providerTrackId: row.providerTrackId,
      providerReleaseId: row.providerReleaseId,
      isrc,
      releaseDate: row.releaseDate as string,
      precision: row.precision as "year" | "month" | "day",
      recordingMbid: args.recordingMbid,
      observedAt: row.observedAt,
    });
  }
  return rows.length;
}