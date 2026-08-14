/* eslint-disable no-console -- pre-lint file: migrate logging to the structured logger on touch */
import app from "./app";
import { wireSongEnrichment } from "./song/wire.js";
import { seedStations, seedPickers, seedSpinitronRoster, backfillStationTimezones, seedRollingStone500List, getRollingStone500EntryCount } from "./lore/seed.js";
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
import { applyCollegeTagMigration } from "./lore/college-tag-migration.js";
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
import { applyLibraryRemovedMigration } from "./lore/library-removed-migration.js";
import { applySpinsPlayedAtIndexMigration } from "./lore/spins-played-at-index-migration.js";
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
import { wireListExtractor } from "./lore/list-wire.js";
import { scrapeAndPopulateList } from "./lore/list-scraper.js";
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
import { prewarmNowPlayingBaseCache } from "./routes/lore/stations.js";
import { scheduleAnonCleanup } from "./lore/anonCleanup.js";
import { applyReplayResolutionMigration } from "./lore/replay-resolution-migration.js";
import { applyImportedSetsMigration } from "./lore/imported-sets-migration.js";
import { resumeReplayResolutionJobs } from "./lore/replay-resolution.js";
import { resumePendingImportedSets } from "./lore/imported-sets.js";
import { resumeReplayMaterializationJobs } from "./lore/replay-materialization.js";
import {
  resumeEmbedResolutionJobs,
  startEmbedResolutionWorker,
} from "./lore/embed-resolution.js";
import { applySocialPresenceMigration } from "./lore/social-presence-migration.js";
import { applyLifetimeCrossingsMigration } from "./lore/lifetime-crossings-migration.js";
import { applyAppleLibraryItemsMigration } from "./lore/apple-library-items-migration.js";
import { startLifetimeCrossingsJob } from "./lore/lifetime-crossings-job.js";
import { startBlendedCrossingsWarmJob } from "./lore/blended-crossings-job.js";
import { warmPersonalCrossingsAtBoot } from "./lore/personal-crossings-warm.js";
import { applyStationBlocklistHideMigration } from "./lore/station-blocklist-hide-migration.js";
import { applySleepStationsMigration } from "./lore/sleep-stations-migration.js";
import { applyEraGenreStationsMigration } from "./lore/era-genre-stations-migration.js";
import { applyWikipediaPublishMigration } from "./lore/wikipedia-publish-migration.js";
import { applyReleaseYearMigration } from "./lore/release-year-migration.js";
import { startReleaseYearBackfillJob } from "./lore/release-year-backfill.js";
import { startPitchforkJob } from "./lore/pitchfork-job.js";
import { startSoundOnSoundClaimsJob } from "./lore/sound-on-sound-claims.js";
import { ingestAllBookSources } from "./lore/book-knowledge.js";
import { applyMetacriticMissCleanupMigration } from "./lore/metacritic-miss-cleanup-migration.js";
import { applyJobTimestampsMigration } from "./lore/job-timestamps-migration.js";

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
    // Kick off the now-playing base fill immediately so the first dial
    // visitor after a restart doesn't pay the ~9s cold scan. Fire-and-forget;
    // it only reads long-existing tables so it can run ahead of the
    // ledger-gated migrations below.
    prewarmNowPlayingBaseCache();
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
    await runMigration("applyLibraryRemovedMigration", applyLibraryRemovedMigration);
    await runMigration("applySpinsPlayedAtIndexMigration", applySpinsPlayedAtIndexMigration);
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
    await runMigration("applyImportedSetsMigration", applyImportedSetsMigration);
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
    // Sleep classification must run BEFORE the blocklist hide so its
    // sleep_mode=true marks exempt those rows from the permanent blocklist
    // predicates. Runs unconditionally (not ledger-once) because its UPDATE
    // must also catch stations discovered after the first run. Both steps
    // are idempotent.
    await runMigration("applyReleaseYearMigration", applyReleaseYearMigration);
    await runMigration("applySleepStationsMigration", applySleepStationsMigration);
    // Classify era-themed / single-genre stations into the hidden era/genre
    // browse mode. Runs AFTER sleep classification so sleep_mode rows are
    // skipped (sleep precedence). Idempotent + catches newly discovered rows.
    await runMigration("applyEraGenreStationsMigration", applyEraGenreStationsMigration);
    // Hide confirmed dead-end stations before any pollers or lease scheduling
    // starts, so existing rows cannot briefly consume watcher slots at boot.
    await runMigration("applyStationBlocklistHideMigration", applyStationBlocklistHideMigration);
    // Tag radio_browser stations whose name matches a university/college pattern
    // as "college". Runs unconditionally at boot to backfill stations that were
    // discovered before ingest-time detection was added. Idempotent (jsonb
    // containment guard skips already-tagged rows).
    await runMigration("applyCollegeTagMigration", applyCollegeTagMigration);
    await runMigration("applyWikipediaPublishMigration", applyWikipediaPublishMigration);
    await runMigration("applyMetacriticMissCleanupMigration", applyMetacriticMissCleanupMigration);
    await runMigration("applyJobTimestampsMigration", applyJobTimestampsMigration);
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
    let rs500ListInfo: { listId: number; url: string } | null = null;
    try {
      rs500ListInfo = await seedRollingStone500List();
    } catch (err) {
      console.error("[lore] Rolling Stone 500 list seed failed", err);
    }
    // Auto-scrape the Rolling Stone 500 list on first boot (or after a partial
    // run) if it doesn't yet have ≥90% of its declared entries. Fire-and-forget
    // so boot doesn't block on the long MB-resolution pass (~500 entries × 1.1s).
    // The scraper uses multi-pass chunked LLM extraction so all 500 albums are
    // captured even though a single LLM call can only return a subset. Entries
    // already in the DB are skipped via onConflictDoNothing, making resumed runs
    // safe and idempotent.
    if (rs500ListInfo) {
      void (async () => {
        try {
          const { entryCount, listLength } = await getRollingStone500EntryCount(rs500ListInfo.listId);
          // Consider the list complete when ≥90% of declared entries are present.
          const completionThreshold = listLength != null ? Math.floor(listLength * 0.9) : 10;
          if (entryCount >= completionThreshold) return; // already substantially populated
          const contact = process.env["MUSICBRAINZ_CONTACT"]?.trim();
          if (!contact) {
            console.info("[lore] RS500 auto-scrape skipped: MUSICBRAINZ_CONTACT not set");
            return;
          }
          const ready = await wireListExtractor();
          if (!ready) {
            console.info("[lore] RS500 auto-scrape skipped: Anthropic AI integration unavailable");
            return;
          }
          console.info(
            `[lore] RS500 auto-scrape: starting population (${entryCount} of ${listLength ?? "?"} entries present)`,
          );
          const result = await scrapeAndPopulateList(rs500ListInfo.listId, rs500ListInfo.url, contact);
          if (result.error) {
            console.warn("[lore] RS500 auto-scrape finished with error:", result.error);
          } else {
            console.info(
              `[lore] RS500 auto-scrape done: ${result.resolved} exact + ${result.fuzzy} fuzzy + ${result.unresolved} unresolved of ${result.total}`,
            );
          }
        } catch (err) {
          console.error("[lore] RS500 auto-scrape failed", err);
        }
      })();
    }
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
      await ingestAllBookSources();
    } catch (err) {
      console.error("[lore] book-knowledge ingest failed", err);
    }
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
    startReleaseYearBackfillJob();
    startPitchforkJob();
    // NOTE: startBeatoJob() is NOT called here until the BEATO_EPISODES video
    // IDs have been verified against https://www.youtube.com/@RickBeato/videos.
    // See Task #136 — publishing claims with unverified YouTube links is
    // unsupported provenance. Activate by importing and calling startBeatoJob()
    // once all seed entries are confirmed.
    startSoundOnSoundClaimsJob();
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
    startBlendedCrossingsWarmJob();
    warmPersonalCrossingsAtBoot();
    startArtPrewarm();
    startPhase3RetryScheduler();
    await resumeReplayResolutionJobs();
    await resumePendingImportedSets();
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
