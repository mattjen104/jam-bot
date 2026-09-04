import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Repair the reviewed US local-radio cohort on existing databases.
 *
 * The seed fixes fresh installs, while this pass handles rows originally
 * inserted by the broad Spinitron fallback and explicit duplicates whose
 * alternate streams prevent exact-URL duplicate detection.
 */
export async function applyLocalRosterRepair(): Promise<void> {
  const metadata = await db.execute(sql`
    UPDATE stations
    SET
      city = CASE slug
        WHEN 'kucr' THEN 'Riverside'
        WHEN 'kxlu' THEN 'Los Angeles'
        WHEN 'ksjs' THEN 'San Jose'
        WHEN 'wluw' THEN 'Chicago'
        WHEN 'kexp' THEN 'Seattle'
        WHEN 'kexp-90-3-fm-seattle' THEN 'Seattle'
        WHEN 'dublab' THEN 'Los Angeles'
        WHEN 'rb-0bb84fe1-e899-11e9-a96c-52543be04c81' THEN 'Los Angeles'
        WHEN 'bytefm-192k' THEN 'Hamburg'
        WHEN 'kcrw-eclectic24' THEN 'Los Angeles'
        WHEN 'kalx' THEN 'Berkeley'
        WHEN 'kcsm' THEN 'San Mateo'
        WHEN 'whpk' THEN 'Chicago'
        WHEN 'wnur' THEN 'Evanston'
        WHEN 'wbez-hd2-vocalo-stream-chicago-il' THEN 'Chicago'
        WHEN 'wfmt-98-7-chicago-il-aac' THEN 'Chicago'
        WHEN 'wfmt-98-7-chicago-il-mp3' THEN 'Chicago'
        ELSE city
      END,
      region = CASE
        WHEN slug IN (
          'kucr', 'kxlu', 'ksjs', 'kexp', 'kexp-90-3-fm-seattle',
          'dublab', 'rb-0bb84fe1-e899-11e9-a96c-52543be04c81',
          'kcrw-eclectic24', 'kalx', 'kcsm'
        ) THEN CASE
          WHEN slug IN ('kexp', 'kexp-90-3-fm-seattle') THEN 'WA'
          ELSE 'CA'
        END
        WHEN slug IN (
          'wluw', 'whpk', 'wnur', 'wbez-hd2-vocalo-stream-chicago-il',
          'wfmt-98-7-chicago-il-aac', 'wfmt-98-7-chicago-il-mp3'
        ) THEN 'IL'
        ELSE region
      END,
      country = CASE
        WHEN slug = 'bytefm-192k' THEN 'DE'
        ELSE 'US'
      END,
      tags = CASE
        WHEN slug IN ('kucr', 'kxlu', 'ksjs', 'wluw')
          THEN (
            SELECT COALESCE(jsonb_agg(DISTINCT tag), '[]'::jsonb)
            FROM (
              SELECT jsonb_array_elements_text(COALESCE(stations.tags, '[]'::jsonb)) AS tag
              UNION ALL SELECT 'college'
            ) tags
          )
        ELSE tags
      END,
      now_playing_source = CASE
        WHEN slug IN ('kxlu', 'ksjs', 'wluw')
          THEN 'spinitron_web'
        ELSE now_playing_source
      END,
      now_playing_config = CASE
        WHEN slug IN ('kxlu', 'ksjs', 'wluw')
          THEN COALESCE(now_playing_config, '{}'::jsonb)
            || jsonb_build_object('callsign', upper(slug))
        ELSE now_playing_config
      END,
      updated_at = now()
    WHERE slug IN (
      'kucr',
      'kxlu',
      'ksjs',
      'wluw',
      'kexp',
      'kexp-90-3-fm-seattle',
      'dublab',
      'rb-0bb84fe1-e899-11e9-a96c-52543be04c81',
      'bytefm-192k',
      'kcrw-eclectic24',
      'kalx',
      'kcsm',
      'whpk',
      'wnur',
      'wbez-hd2-vocalo-stream-chicago-il',
      'wfmt-98-7-chicago-il-aac',
      'wfmt-98-7-chicago-il-mp3'
    )
  `);

  const duplicates = await db.execute(sql`
    WITH mappings(duplicate_slug, canonical_slug) AS (
      VALUES
        ('kexp-90-3-fm-seattle', 'kexp'),
        ('rb-0bb84fe1-e899-11e9-a96c-52543be04c81', 'dublab'),
        ('bytefm-hh-ukw', 'bytefm-192k'),
        ('wfmt-98-7-chicago-il-aac', 'wfmt-98-7-chicago-il-mp3')
    )
    UPDATE stations duplicate
    SET
      hidden = true,
      active = false,
      automatic_cull_reason = 'duplicate_stream',
      automatic_cull_canonical_station_id = canonical.id,
      updated_at = now()
    FROM mappings
    JOIN stations canonical ON canonical.slug = mappings.canonical_slug
    WHERE duplicate.slug = mappings.duplicate_slug
      AND duplicate.id <> canonical.id
      AND (
        duplicate.hidden = false
        OR duplicate.active = true
        OR duplicate.automatic_cull_canonical_station_id IS DISTINCT FROM canonical.id
      )
  `);

  console.info(
    JSON.stringify({
      severity: "info",
      migration: "applyLocalRosterRepair",
      metadataRows: metadata.rowCount ?? 0,
      duplicatesHidden: duplicates.rowCount ?? 0,
    }),
  );
}