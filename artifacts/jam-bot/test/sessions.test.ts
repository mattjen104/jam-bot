import { describe, it, expect } from "vitest";
import {
  resolvePersonSessions,
  SESSION_TRACK_CAP,
} from "../src/turntable/sessions.js";
import type { PersonInfo } from "../src/turntable/person.js";
import type { SearchResultTrack } from "../src/spotify/client.js";

function person(overrides: Partial<PersonInfo> = {}): PersonInfo {
  return {
    name: "Beck",
    knownFor: [],
    tags: [],
    collaborators: [],
    fetchedAtMs: 0,
    ...overrides,
  };
}

function hit(overrides: Partial<SearchResultTrack> = {}): SearchResultTrack {
  return {
    id: "t1",
    uri: "spotify:track:t1",
    title: "Loser",
    artist: "Beck",
    album: "Mellow Gold",
    durationMs: 234000,
    ...overrides,
  };
}

const works = (...titles: string[]): PersonInfo["knownFor"] =>
  titles.map((title) => ({ title, mbUrl: `https://mb/${title}` }));

describe("resolvePersonSessions", () => {
  it("keeps confident matches and reports the resolved track shape", async () => {
    const p = person({ name: "Beck", knownFor: works("Odelay", "Sea Change") });
    const search = async (q: string): Promise<SearchResultTrack | null> =>
      q.startsWith("Odelay")
        ? hit({ id: "t-odelay", uri: "spotify:track:t-odelay", title: "Devils Haircut", artist: "Beck" })
        : hit({ id: "t-sea", uri: "spotify:track:t-sea", title: "Lost Cause", artist: "Beck" });
    const out = await resolvePersonSessions(p, { search });
    expect(out.map((t) => t.trackId)).toEqual(["t-odelay", "t-sea"]);
    expect(out[0]).toMatchObject({
      uri: "spotify:track:t-odelay",
      title: "Devils Haircut",
      artist: "Beck",
    });
  });

  it("drops hits whose artist isn't a confident match for the person", async () => {
    const p = person({ name: "Beck", knownFor: works("Odelay", "Sea Change") });
    const search = async (q: string): Promise<SearchResultTrack | null> =>
      q.startsWith("Odelay")
        ? hit({ id: "t-ok", artist: "Beck" })
        : // Same-named song by an unrelated artist — must be skipped, not queued.
          hit({ id: "t-wrong", artist: "Some Cover Band" });
    const out = await resolvePersonSessions(p, { search });
    expect(out.map((t) => t.trackId)).toEqual(["t-ok"]);
  });

  it("dedupes repeated track ids and respects the cap", async () => {
    const p = person({ name: "Beck", knownFor: works("A", "B", "C", "D") });
    // Every work resolves to the same track id — only one should survive.
    const dup = await resolvePersonSessions(p, { search: async () => hit({ id: "same" }) });
    expect(dup).toHaveLength(1);

    const many = person({
      name: "Beck",
      knownFor: works(...Array.from({ length: SESSION_TRACK_CAP + 3 }, (_, i) => `Album ${i}`)),
    });
    let n = 0;
    const out = await resolvePersonSessions(many, {
      search: async () => hit({ id: `t-${n++}`, uri: `spotify:track:t-${n}` }),
    });
    expect(out).toHaveLength(SESSION_TRACK_CAP);

    // An explicit smaller cap is honored.
    n = 0;
    const capped = await resolvePersonSessions(many, {
      cap: 2,
      search: async () => hit({ id: `c-${n++}` }),
    });
    expect(capped).toHaveLength(2);
  });

  it("returns empty when there's no name or no known work, and never throws on search errors", async () => {
    expect(await resolvePersonSessions(person({ knownFor: [] }))).toEqual([]);
    expect(
      await resolvePersonSessions(person({ name: "", knownFor: works("X") })),
    ).toEqual([]);
    const out = await resolvePersonSessions(
      person({ name: "Beck", knownFor: works("X", "Y") }),
      {
        search: async () => {
          throw new Error("spotify down");
        },
      },
    );
    expect(out).toEqual([]);
  });
});
