import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const LOGO_COLUMNS = [
  "logo_source",
  "logo_width",
  "logo_height",
  "logo_checked_at",
  "station_icon_url",
  "station_icon_source",
  "station_icon_width",
  "station_icon_height",
  "station_icon_checked_at",
] as const;

/**
 * Add quality/provenance fields for station logos and classify legacy URLs.
 *
 * Existing non-Radio-Browser logo URLs are treated as curated so automatic
 * homepage discovery can never replace an operator-owned asset. Directory
 * favicons remain eligible for a stronger first-party website logo.
 */
export async function applyStationLogoMigration(): Promise<void> {
  const existing = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stations'
      AND column_name = ANY(
        ARRAY[
          'logo_source', 'logo_width', 'logo_height', 'logo_checked_at',
          'station_icon_url', 'station_icon_source', 'station_icon_width',
          'station_icon_height', 'station_icon_checked_at'
        ]::text[]
      )
  `);

  if (existing.rows.length !== LOGO_COLUMNS.length) {
    await db.execute(sql`
      ALTER TABLE stations
        ADD COLUMN IF NOT EXISTS logo_source text,
        ADD COLUMN IF NOT EXISTS logo_width integer,
        ADD COLUMN IF NOT EXISTS logo_height integer,
        ADD COLUMN IF NOT EXISTS logo_checked_at timestamptz,
        ADD COLUMN IF NOT EXISTS station_icon_url text,
        ADD COLUMN IF NOT EXISTS station_icon_source text,
        ADD COLUMN IF NOT EXISTS station_icon_width integer,
        ADD COLUMN IF NOT EXISTS station_icon_height integer,
        ADD COLUMN IF NOT EXISTS station_icon_checked_at timestamptz
    `);
  }

  await db.execute(sql`
    UPDATE stations
    SET logo_source = CASE
      WHEN logo_url IS NULL THEN NULL
      WHEN source = 'radio_browser' THEN 'radio_browser'
      ELSE 'curated'
    END
    WHERE logo_source IS NULL
      AND logo_url IS NOT NULL
  `);

  await db.execute(sql`
    UPDATE stations
    SET
      station_icon_url = logo_url,
      station_icon_source = logo_source,
      station_icon_width = logo_width,
      station_icon_height = logo_height
    WHERE station_icon_url IS NULL
      AND logo_url IS NOT NULL
      AND lower(logo_url) NOT LIKE '%spinitron.com%'
      AND (
        logo_source = 'radio_browser'
        OR (
          logo_width IS NOT NULL
          AND logo_height IS NOT NULL
          AND abs(logo_width - logo_height)::numeric
            / greatest(logo_width, logo_height) <= 0.05
        )
      )
  `);

  console.info("[migration] station logo metadata: OK");
}