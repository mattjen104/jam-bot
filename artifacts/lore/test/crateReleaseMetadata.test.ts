/**
 * The crate resolves release metadata through the API server, never
 * musicbrainz.org directly: one POST per batch of unresolved MBIDs, results
 * session-cached by MBID, explicit nulls for rows the server couldn't place
 * (so they are not re-asked on every render burst).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  queueReleaseMetadata,
  releaseMetadataCache,
  isReleaseMetadataPending,
} from "../src/lib/crate";

const MBID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const MBID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

describe("queueReleaseMetadata", () => {
  beforeEach(() => {
    releaseMetadataCache.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    releaseMetadataCache.clear();
  });

  it("POSTs the batch to the server endpoint and caches the results", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      metadata: {
        [MBID_A]: { title: "OK Computer", releaseGroupMbid: "rg-1" },
        [MBID_B]: null,
      },
    }), { status: 200 }));

    await queueReleaseMetadata([MBID_A, MBID_B]);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/me/library/release-metadata");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ mbids: [MBID_A, MBID_B] });
    expect(releaseMetadataCache.get(MBID_A)).toEqual({
      title: "OK Computer",
      releaseGroupMbid: "rg-1",
    });
    expect(releaseMetadataCache.get(MBID_B)).toBeNull();
    expect(isReleaseMetadataPending(MBID_A)).toBe(false);
  });

  it("never calls musicbrainz.org from the browser", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ metadata: {} }), { status: 200 }));
    await queueReleaseMetadata([MBID_A]);
    for (const [url] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).not.toContain("musicbrainz.org");
    }
  });

  it("caches nulls on server failure so rows are not re-queued", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("boom", { status: 500 }));
    await queueReleaseMetadata([MBID_A]);
    expect(releaseMetadataCache.get(MBID_A)).toBeNull();
    expect(isReleaseMetadataPending(MBID_A)).toBe(false);
  });
});
