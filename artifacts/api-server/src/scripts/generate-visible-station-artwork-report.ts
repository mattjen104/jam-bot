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
  "station_icon_url",
  "station_icon_source",
  "station_icon_width",
  "station_icon_height",
] as const;

export type VisibleStationArtworkHeader =
  (typeof VISIBLE_STATION_ARTWORK_HEADERS)[number];

export type VisibleStationArtworkRow = Record<
  VisibleStationArtworkHeader,
  string | number | null
>;

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

async function generateReport(): Promise<void> {
  const rows = await db
    .select({
      name: stationsTable.name,
      slug: stationsTable.slug,
      homepage_url: stationsTable.homepageUrl,
      logo_url: stationsTable.logoUrl,
      logo_source: stationsTable.logoSource,
      logo_width: stationsTable.logoWidth,
      logo_height: stationsTable.logoHeight,
      station_icon_url: stationsTable.stationIconUrl,
      station_icon_source: stationsTable.stationIconSource,
      station_icon_width: stationsTable.stationIconWidth,
      station_icon_height: stationsTable.stationIconHeight,
    })
    .from(stationsTable)
    .where(
      and(
        eq(stationsTable.active, true),
        eq(stationsTable.hidden, false),
        sql`NULLIF(BTRIM(${stationsTable.logoUrl}), '') IS NULL`,
        sql`NULLIF(BTRIM(${stationsTable.stationIconUrl}), '') IS NULL`,
      ),
    )
    .orderBy(asc(stationsTable.name), asc(stationsTable.slug));

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