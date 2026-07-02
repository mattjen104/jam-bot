import {
  fetchLabelName,
  fetchLabelReleaseRecordings,
} from "@workspace/song-enrichment";
import { upsertPicker, persistPick } from "./picks.js";

/**
 * Label ingestion worker — the highest-value source for the obscure music radio
 * never touches. Given a MusicBrainz label MBID it:
 *   1. Creates/updates a picker (type='label', trust_tier=1).
 *   2. Pulls the label's releases + their recordings from MusicBrainz (one
 *      request, honoring the 1 req/sec budget — recordings arrive with their
 *      canonical ids, so they land on the spine at "recording_id" confidence
 *      with no text resolution).
 *   3. Logs one pick per recording (source='label_release', picked_at = the
 *      release year, source_url = the MusicBrainz release page).
 *
 * Because releases are inherently ordered by date, picks carry an `ordinal` so
 * the generalized segue notion can ride a label's catalogue in release order.
 * Best-effort — never throws; returns a small summary for the admin caller.
 */

/** Canonical public URL for a MusicBrainz release (the "released on" link). */
export function releaseUrl(releaseId: string): string {
  return `https://musicbrainz.org/release/${releaseId}`;
}

export interface LabelSeedResult {
  pickerId: number;
  handle: string;
  name: string;
  found: number;
  logged: number;
}

export async function seedLabelPicker(args: {
  labelMbid: string;
  /** Optional display name override; otherwise resolved from MusicBrainz. */
  name?: string;
  homeUrl?: string;
}): Promise<LabelSeedResult> {
  const labelMbid = args.labelMbid.trim();
  if (!labelMbid) throw new Error("labelMbid is required");

  const resolvedName =
    args.name?.trim() || (await fetchLabelName(labelMbid)) || labelMbid;

  const picker = await upsertPicker({
    pickerType: "label",
    name: resolvedName,
    homeUrl: args.homeUrl,
    sourceRef: { labelMbid },
    trustTier: 1,
    description: `Rideable roster — releases on ${resolvedName}.`,
  });

  const recordings = await fetchLabelReleaseRecordings(labelMbid);
  let logged = 0;
  let ordinal = 0;
  for (const rec of recordings) {
    const { logged: wrote } = await persistPick({
      pickerId: picker.id,
      source: "label_release",
      rawArtist: rec.artist ?? resolvedName,
      rawTitle: rec.title,
      recordingId: rec.recordingId,
      ...(rec.artistMbid ? { artistMbid: rec.artistMbid } : {}),
      sourceUrl: releaseUrl(rec.releaseId),
      context: rec.releaseTitle
        ? `Released on ${resolvedName} — ${rec.releaseTitle}`
        : `Released on ${resolvedName}`,
      ordinal: ordinal++,
      externalId: `label:${labelMbid}:${rec.recordingId}`,
      ...(rec.year != null
        ? { pickedAt: new Date(Date.UTC(rec.year, 0, 1)) }
        : {}),
    });
    if (wrote) logged++;
  }

  if (logged > 0) {
    console.info(
      `[lore] label ${resolvedName} (${labelMbid}) logged ${logged}/${recordings.length} pick(s)`,
    );
  }

  return {
    pickerId: picker.id,
    handle: picker.handle,
    name: resolvedName,
    found: recordings.length,
    logged,
  };
}
