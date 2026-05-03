import { describe, it, expect } from "vitest";
import {
  recordPlayed,
  recentPlayed,
  lastPlayed,
  countPlaysOf,
  searchPlayedByTitleOrArtist,
  recordPendingRequest,
  popPendingRequest,
} from "../src/db.js";

function uniqueId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

describe("db roundtrips", () => {
  it("records a played track and reads it back via lastPlayed / recentPlayed / countPlaysOf", () => {
    const trackId = uniqueId("trk");
    recordPlayed({
      track_id: trackId,
      title: "Hey Jude",
      artist: "The Beatles",
      album: "1",
      spotify_url: "https://open.spotify.com/track/x",
      duration_ms: 431000,
      requested_by_slack_user: "U1",
      requested_query: "hey jude",
    });

    const last = lastPlayed();
    expect(last?.track_id).toBe(trackId);
    expect(last?.title).toBe("Hey Jude");
    expect(last?.requested_by_slack_user).toBe("U1");

    expect(countPlaysOf(trackId)).toBe(1);
    recordPlayed({ track_id: trackId, title: "Hey Jude", artist: "The Beatles" });
    expect(countPlaysOf(trackId)).toBe(2);

    const recent = recentPlayed(5);
    expect(recent[0]?.track_id).toBe(trackId);
  });

  it("searches played tracks by title and artist with LIKE", () => {
    const trackId = uniqueId("srch");
    recordPlayed({
      track_id: trackId,
      title: "Purple Haze",
      artist: "Jimi Hendrix",
    });
    const byTitle = searchPlayedByTitleOrArtist("purple");
    expect(byTitle.some((r) => r.track_id === trackId)).toBe(true);
    const byArtist = searchPlayedByTitleOrArtist("hendrix");
    expect(byArtist.some((r) => r.track_id === trackId)).toBe(true);
  });

  it("pops pending requests in FIFO order and returns undefined when empty", () => {
    const trackId = uniqueId("pend");
    recordPendingRequest(trackId, "U1", "first");
    recordPendingRequest(trackId, "U2", "second");

    const a = popPendingRequest(trackId);
    const b = popPendingRequest(trackId);
    const c = popPendingRequest(trackId);

    expect(a?.requested_by_slack_user).toBe("U1");
    expect(a?.requested_query).toBe("first");
    expect(b?.requested_by_slack_user).toBe("U2");
    expect(b?.requested_query).toBe("second");
    expect(c).toBeUndefined();
  });
});
