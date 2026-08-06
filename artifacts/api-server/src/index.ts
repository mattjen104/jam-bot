import app from "./app";
import { wireSongEnrichment } from "./song/wire.js";
import { seedStations, seedPickers, seedSpinitronRoster, backfillStationTimezones } from "./lore/seed.js";
import { startLorePoller } from "./lore/poller.js";
import { startLeaseScheduler } from "./lore/socket-leases.js";
import { startBlogPoller } from "./lore/blog-poller.js";
import { startListCandidateWorker } from "./lore/list-candidates.js";
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
import { applyShowDjNamesMigration } from "./lore/show-djnames-migration.js";
import { runMigration } from "./lore/boot-migrations.js";
import { startGenreBackfillJob } from "./lore/genre-backfill.js";
import { startIsrcEnrichmentJob } from "./lore/isrc-enrichment.js";
import { startHomepageScraper } from "./lore/homepage-scraper.js";
import { startDonateChecker } from "./lore/donate-checker.js";
import { applyDonateCheckerMigration } from "./lore/donate-checker-migration.js";
import { applySupportHoldsMigration } from "./lore/support-holds-migration.js";
import { startDiscoveryScoreJob } from "./lore/discovery-score-job.js";
import { startQualityRecomputeJob } from "./lore/quality.js";
import { startArtPrewarm } from "./lore/artPrewarm.js";
import { applyStationScheduleMigration } from "./lore/station-schedule-migration.js";
import { applyPendingKeepsMigration } from "./lore/pending-keeps-migration.js";
import { applyLibraryExportMigration } from "./lore/library-export-migration.js";
import { applyAutomationClassMigration } from "./lore/automation-class-migration.js";
import { applyLibrarySyncMigration } from "./lore/library-sync-migration.js";
import { applyImportBufferMigration } from "./lore/import-buffer-migration.js";
import { applyImportRetryExhaustedMigration } from "./lore/import-retry-exhausted-migration.js";
import { applyLedgerMigration } from "./lore/ledger-migration.js";
import { applySelectorClaimsMigration } from "./lore/selector-claims-migration.js";
import { applySpotifyLibraryItemsMigration } from "./lore/spotify-library-items-migration.js";
import { syncScrapedShows } from "./lore/scraped-shows-sync.js";
import { wireScheduleExtractor } from "./lore/schedule-wire.js";
import { wireImageExtractor } from "./lore/image-wire.js";
import { startScheduleScraper } from "./lore/schedule-scraper.js";
import { markOrphanedImportJobsAsError, markOrphanedSyncJobsAsError, startPhase3RetryScheduler } from "./routes/me/index.js";
import { applyDeviceIdentityMigration } from "./lore/device-identity-migration.js";
import { applyMigrationCompletionsMigration } from "./lore/migration-completions-migration.js";
import { applySpinDedupCleanup } from "./lore/spin-dedup-cleanup.js";
import { applyCrossingsCacheMigration } from "./lore/crossings-cache-migration.js";
import { applyBlendedCrossingsCacheMigration } from "./lore/blended-crossings-cache-migration.js";
import { applyImportItemsMigration } from "./lore/import-items-migration.js";
import { applyAttendanceMigration } from "./lore/attendance-migration.js";
import { applyTasteSeedsMigration } from "./lore/taste-seeds-migration.js";
import { applyBottlesMigration } from "./lore/bottles-migration.js";
import { applyLibraryProvenanceBackfill } from "./lore/library-provenance-backfill.js";
import { applyGeniusFragmentPointerMigration } from "./lore/genius-fragment-migration.js";
import { applyLoreSettingsMigration } from "./lore/lore-settings-migration.js";
import {
  applyArtistMetadataCleanup,
  applyResolutionCollisionCleanup,
  applySyntheticUrlArtistCleanup,
  applyUrlArtistRepair,
} from "./lore/artist-metadata-cleanup.js";
import { startSessionExpiryWorker } from "./routes/me/attendance.js";
import { scheduleAnonCleanup } from "./lore/anonCleanup.js";
import { applyReplayResolutionMigration } from "./lore/replay-resolution-migration.js";
import { resumeReplayResolutionJobs } from "./lore/replay-resolution.js";
import { resumeReplayMaterializationJobs } from "./lore/replay-materialization.js";
import {
  resumeEmbedResolutionJobs,
  startEmbedResolutionWorker,
} from "./lore/embed-resolution.js";
import { applySocialPresenceMigration } from "./lore/social-presence-migration.js";
import { applyLifetimeCrossingsMigration } from "./lore/lifetime-crossings-migration.js";
import { applyAppleLibraryItemsMigration } from "./lore/apple-library-items-migration.js";
import { startLifetimeCrossingsJob } from "./lore/lifetime-crossings-job.js";

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
    await markOrphanedImportJobsAsError();
    await markOrphanedSyncJobsAsError();
    wireSongEnrichment();
    // Must run first — other ledger-gated migrations depend on this table.
    await runMigration("applyMigrationCompletionsMigration", applyMigrationCompletionsMigration);
    await runMigration("applyStationDiscoveryMigration", applyStationDiscoveryMigration);
    await runMigration("applyPickerDiscoveryMigration", applyPickerDiscoveryMigration);
    await runMigration("applyStationScheduleMigration", applyStationScheduleMigration);
    await runMigration("applyDeviceIdentityMigration", applyDeviceIdentityMigration);
    await runMigration("applyPendingKeepsMigration", applyPendingKeepsMigration);
    await runMigration("applyLibraryExportMigration", applyLibraryExportMigration);
    await runMigration("applyLibraryProvenanceBackfill", async () => {
      await applyLibraryProvenanceBackfill();
    });
    await runMigration("applyAutomationClassMigration", applyAutomationClassMigration);
    await runMigration("applyLibrarySyncMigration", applyLibrarySyncMigration);
    await runMigration("applyImportBufferMigration", applyImportBufferMigration);
    await runMigration("applyImportRetryExhaustedMigration", applyImportRetryExhaustedMigration);
    await runMigration("applyLedgerMigration", applyLedgerMigration);
    await runMigration("applySelectorClaimsMigration", applySelectorClaimsMigration);
    await runMigration("applySpotifyLibraryItemsMigration", applySpotifyLibraryItemsMigration);
    await runMigration("applySpinDedupCleanup", applySpinDedupCleanup);
    await runMigration("applyCrossingsCacheMigration", applyCrossingsCacheMigration);
    await runMigration("applyBlendedCrossingsCacheMigration", applyBlendedCrossingsCacheMigration);
    await runMigration("applyImportItemsMigration", applyImportItemsMigration);
    await runMigration("applyAttendanceMigration", applyAttendanceMigration);
    await runMigration("applyTasteSeedsMigration", applyTasteSeedsMigration);
    await runMigration("applyBottlesMigration", applyBottlesMigration);
    await runMigration("applyLoreSettingsMigration", applyLoreSettingsMigration);
    await runMigration("applyGeniusFragmentPointerMigration", applyGeniusFragmentPointerMigration);
    await runMigration("applyReplayResolutionMigration", applyReplayResolutionMigration);
    await runMigration("applySupportHoldsMigration", applySupportHoldsMigration);
    await runMigration("applySocialPresenceMigration", applySocialPresenceMigration);
    await runMigration("applyShowDjNamesMigration", applyShowDjNamesMigration);
    await runMigration("applyArtistMetadataCleanup", async () => {
      await applyArtistMetadataCleanup();
    });
    await runMigration("applyUrlArtistRepair", async () => {
      await applyUrlArtistRepair();
    });
    await runMigration("applySyntheticUrlArtistCleanup", async () => {
      await applySyntheticUrlArtistCleanup();
    });
    await runMigration("applyResolutionCollisionCleanup", async () => {
      await applyResolutionCollisionCleanup();
    });
    await ensurePicksUnifiedView();
    await seedStations();
    try {
      await backfillStationTimezones();
    } catch (err) {
      console.error("[lore] timezone backfill failed", err);
    }
    // After timezone backfill so the spin stamper sees freshly-inferred zones.
    await syncScrapedShows();
    try {
      await seedSpinitronRoster();
    } catch (err) {
      console.error("[lore] Spinitron roster seed failed", err);
    }
    await seedPickers();
    try {
      await backfillRadioBrowserIcyEnrollment();
    } catch (err) {
      console.error("[lore] radio-browser ICY backfill failed", err);
    }
    await startLorePoller();
    startLeaseScheduler();
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
    startListCandidateWorker();
    await startBackfillJob();
    await startReconcileJob();
    startSegueJob();
    startWikipediaJob();
    startKexpShowsHarvester();
    startStreamHealthWorker();
    startRadioBrowserWorker();
    startGenreBackfillJob();
    startIsrcEnrichmentJob();
    startHomepageScraper();
    await runMigration("applyDonateCheckerMigration", applyDonateCheckerMigration);
    startDonateChecker();
    if (await wireScheduleExtractor()) {
      startScheduleScraper();
    }
    await wireImageExtractor();
    startDiscoveryScoreJob();
    startQualityRecomputeJob();
    await runMigration("applyLifetimeCrossingsMigration", applyLifetimeCrossingsMigration);
    await runMigration("applyAppleLibraryItemsMigration", applyAppleLibraryItemsMigration);
    startLifetimeCrossingsJob();
    startArtPrewarm();
    startPhase3RetryScheduler();
    await resumeReplayResolutionJobs();
    await resumeReplayMaterializationJobs();
    await resumeEmbedResolutionJobs();
    startEmbedResolutionWorker();
    startSessionExpiryWorker();
    scheduleAnonCleanup();
  } catch (err) {
    console.error("[lore] boot failed", err);
  }
}

void bootLore();
