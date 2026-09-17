/* eslint-disable no-console -- this file is a command-line report generator */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, stationsTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";

const REPORT_PATH = fileURLToPath(
  new URL("../../../../reports/visible-stations-still-missing-artwork.csv", import.meta.url),
);

export const VISIBLE_STATION_ARTWORK_HEADERS = [
  "name",
  "slug",
  "homepage_url",
  "logo_url",
  "logo_source",
  "logo_width",
  "logo_height",
  "logo_checked_at",
  "logo_check_state",
  "station_icon_url",
  "station_icon_source",
  "station_icon_width",
  "station_icon_height",
  "station_icon_checked_at",
  "station_icon_check_state",
] as const;

export type VisibleStationArtworkHeader =
  (typeof VISIBLE_STATION_ARTWORK_HEADERS)[number];

export type ArtworkCheckState =
  | "never_checked"
  | "checked_missing"
  | "present";

export type VisibleStationArtworkRow = Record<
  VisibleStationArtworkHeader,
  string | number | null
>;

export function artworkCheckState(
  url: string | null,
  checkedAt: Date | string | null,
): ArtworkCheckState {
  if (url?.trim()) return "present";
  return checkedAt == null ? "never_checked" : "checked_missing";
}

function csvField(value: string | number | null): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function assertReportShape(rows: VisibleStationArtworkRow[]): void {
  const expectedKeys = [...VISIBLE_STATION_ARTWORK_HEADERS].sort();
  for (const row of rows) {
    const actualKeys = Object.keys(row).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      throw new Error(
        `visible station artwork row has invalid columns: ${actualKeys.join(",")}`,
      );
    }

    for (const header of VISIBLE_STATION_ARTWORK_HEADERS) {
      const value = row[header];
      if (
        value !== null &&
        typeof value !== "string" &&
        typeof value !== "number"
      ) {
        throw new Error(
          `visible station artwork column ${header} has an invalid value`,
        );
      }
    }
  }
}

export function buildVisibleStationArtworkCsv(
  rows: VisibleStationArtworkRow[],
): string {
  assertReportShape(rows);
  const lines = [
    VISIBLE_STATION_ARTWORK_HEADERS.join(","),
    ...rows.map((row) =>
      VISIBLE_STATION_ARTWORK_HEADERS.map((header) => csvField(row[header])).join(
        ",",
      ),
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export async function selectVisibleStationArtworkRows(): Promise<
  VisibleStationArtworkRow[]
> {
  const rows = await db
    .select({
      name: stationsTable.name,
      slug: stationsTable.slug,
      homepage_url: stationsTable.homepageUrl,
      logo_url: stationsTable.logoUrl,
      logo_source: stationsTable.logoSource,
      logo_width: stationsTable.logoWidth,
      logo_height: stationsTable.logoHeight,
      logo_checked_at: stationsTable.logoCheckedAt,
      station_icon_url: stationsTable.stationIconUrl,
      station_icon_source: stationsTable.stationIconSource,
      station_icon_width: stationsTable.stationIconWidth,
      station_icon_height: stationsTable.stationIconHeight,
      station_icon_checked_at: stationsTable.stationIconCheckedAt,
    })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        sql`(
          NULLIF(BTRIM(${stationsTable.logoUrl}), '') IS NULL
          OR NULLIF(BTRIM(${stationsTable.stationIconUrl}), '') IS NULL
        )`,
      ),
    )
    .orderBy(asc(stationsTable.name), asc(stationsTable.slug));

  return rows.map((row) => ({
    name: row.name,
    slug: row.slug,
    homepage_url: row.homepage_url,
    logo_url: row.logo_url,
    logo_source: row.logo_source,
    logo_width: row.logo_width,
    logo_height: row.logo_height,
    logo_checked_at: row.logo_checked_at?.toISOString() ?? null,
    logo_check_state: artworkCheckState(row.logo_url, row.logo_checked_at),
    station_icon_url: row.station_icon_url,
    station_icon_source: row.station_icon_source,
    station_icon_width: row.station_icon_width,
    station_icon_height: row.station_icon_height,
    station_icon_checked_at: row.station_icon_checked_at?.toISOString() ?? null,
    station_icon_check_state: artworkCheckState(
      row.station_icon_url,
      row.station_icon_checked_at,
    ),
  }));
}

async function generateReport(): Promise<void> {
  const rows = await selectVisibleStationArtworkRows();
  const csv = buildVisibleStationArtworkCsv(rows);
  await writeFile(REPORT_PATH, csv);
  console.info(`Wrote ${rows.length} unresolved visible station(s) to ${REPORT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  generateReport()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
