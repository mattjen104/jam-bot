import app from "./app";
import { wireSongEnrichment } from "./song/wire.js";
import { seedStations, seedPickers } from "./lore/seed.js";
import { startLorePoller } from "./lore/poller.js";
import { startBlogPoller } from "./lore/blog-poller.js";
import { startBackfillJob } from "./lore/backfill.js";
import { startReconcileJob } from "./lore/reconcile.js";
import { startNtsPoller } from "./lore/nts.js";
import {
  seedClassicAlbumsPicker,
  startClassicAlbumsPoller,
} from "./lore/classic-albums.js";
import {
  seedSongExploderPicker,
  startSongExploderPoller,
} from "./lore/song-exploder.js";
import {
  seedBandcampDailyPicker,
  startBandcampDailyPoller,
} from "./lore/bandcamp-daily.js";
import { startSegueJob } from "./lore/segue-job.js";
import { startWikipediaJob } from "./lore/wikipedia-job.js";
import { ensurePicksUnifiedView } from "./lore/view.js";
import { startKexpShowsHarvester } from "./lore/kexp-shows.js";
import {
  startRadioBrowserWorker,
  backfillRadioBrowserIcyEnrollment,
} from "./lore/radio-browser.js";
import { startStreamHealthWorker } from "./lore/stream-health.js";
import { applyStationDiscoveryMigration } from "./lore/station-migration.js";
import { applyPickerDiscoveryMigration } from "./lore/picker-migration.js";
import { startGenreBackfillJob } from "./lore/genre-backfill.js";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

/**
 * Boot the Lore radio pipeline: wire the enrichment lib, seed the curated
 * stations, then start the now-playing pollers. All best-effort — failures here
 * log but never take the API down.
 */
async function bootLore(): Promise<void> {
  try {
    wireSongEnrichment();
    await applyStationDiscoveryMigration();
    await applyPickerDiscoveryMigration();
    await ensurePicksUnifiedView();
    await seedStations();
    await seedPickers();
    try {
      await backfillRadioBrowserIcyEnrollment();
    } catch (err) {
      console.error("[lore] radio-browser ICY backfill failed", err);
    }
    await startLorePoller();
    await startBlogPoller();
    await startNtsPoller();
    try {
      await seedClassicAlbumsPicker();
    } catch (err) {
      console.error("[lore] classic-albums picker seed failed", err);
    }
    startClassicAlbumsPoller();
    try {
      await seedSongExploderPicker();
    } catch (err) {
      console.error("[lore] song-exploder picker seed failed", err);
    }
    startSongExploderPoller();
    try {
      await seedBandcampDailyPicker();
    } catch (err) {
      console.error("[lore] bandcamp-daily picker seed failed", err);
    }
    startBandcampDailyPoller();
    await startBackfillJob();
    await startReconcileJob();
    startSegueJob();
    startWikipediaJob();
    startKexpShowsHarvester();
    startStreamHealthWorker();
    startRadioBrowserWorker();
    startGenreBackfillJob();
  } catch (err) {
    console.error("[lore] boot failed", err);
  }
}

void bootLore();
