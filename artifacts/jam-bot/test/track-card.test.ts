import { describe, it, expect, beforeEach } from "vitest";
import {
  renderTrackCard,
  putCard,
  getCard,
  deleteCard,
  cardKey,
  clearCards,
  CARD_TAB_ACTION,
  CARD_PERSON_ACTION,
  CARD_BACK_ACTION,
  PERSON_BUTTON_MAX,
  type TrackCardState,
  type CardTrack,
} from "../src/slack/track-card.js";
import type { TrackKnowledge } from "../src/turntable/knowledge.js";
import type { TrackContext } from "../src/turntable/context.js";
import type { TrackLinks } from "../src/turntable/odesli.js";

function track(overrides: Partial<CardTrack> = {}): CardTrack {
  return {
    id: "trk1",
    title: "Outro",
    artist: "M83",
    album: "Hurry Up, We're Dreaming",
    albumImageUrl: "https://img/cover.jpg",
    durationMs: 221000,
    progressMs: 0,
    spotifyUrl: "https://open.spotify.com/track/trk1",
    artistIds: ["art-m83"],
    ...overrides,
  };
}

function baseState(overrides: Partial<TrackCardState> = {}): TrackCardState {
  return {
    channel: "C1",
    ts: "1.1",
    source: "jam",
    track: track(),
    requestedBy: null,
    requestedQuery: null,
    viaIsrc: true,
    view: { kind: "tab", tab: "now" },
    people: new Map(),
    ...overrides,
  };
}

const knowledge: TrackKnowledge = {
  recordingId: "rec1",
  approximate: false,
  personnel: [
    { role: "producer", name: "Justin Meldal-Johnsen", artistId: "art-jmj" },
    { role: "synthesizer", name: "Anthony Gonzalez" },
  ],
};

const context: TrackContext = {
  tags: ["dream pop", "shoegaze"],
  similarArtists: ["Beach House"],
  bio: "M83 is a French project.",
  approximate: false,
};

const links: TrackLinks = {
  platforms: [{ name: "Apple Music", url: "https://music.apple.com/1" }],
  pageUrl: "https://song.link/s/abc",
  fetchedAtMs: 0,
};

function actionIds(blocks: unknown[]): string[] {
  const ids: string[] = [];
  for (const b of blocks as Array<{ elements?: Array<{ action_id?: string }> }>) {
    for (const el of b.elements ?? []) {
      if (el.action_id) ids.push(el.action_id);
    }
  }
  return ids;
}

function rendered(blocks: unknown[]): string {
  return JSON.stringify(blocks);
}

/** Person explore buttons: action_id `jam_card_person:<idx>`, value = artistId. */
function personButtons(
  blocks: unknown[],
): Array<{ action_id: string; value: string; text: { text: string } }> {
  const out: Array<{ action_id: string; value: string; text: { text: string } }> =
    [];
  for (const b of blocks as Array<{
    elements?: Array<{
      type?: string;
      action_id?: string;
      value?: string;
      text?: { text?: string };
    }>;
  }>) {
    for (const el of b.elements ?? []) {
      if (
        el.type === "button" &&
        el.action_id?.startsWith(`${CARD_PERSON_ACTION}:`)
      ) {
        out.push({
          action_id: el.action_id,
          value: el.value ?? "",
          text: { text: el.text?.text ?? "" },
        });
      }
    }
  }
  return out;
}

describe("renderTrackCard", () => {
  it("now-only card has no tab nav when nothing is enriched yet", () => {
    const { blocks, text } = renderTrackCard(baseState());
    expect(text).toContain("Outro");
    // No tab buttons until there's a second tab.
    expect(actionIds(blocks)).not.toContain(`${CARD_TAB_ACTION}:credits`);
    expect(rendered(blocks)).toContain("Now playing");
  });

  it("shows the vote button and matched-by-title note when applicable", () => {
    const state = baseState({
      source: "turntable",
      viaIsrc: false,
      vote: { count: 2, threshold: 3 },
    });
    const { blocks } = renderTrackCard(state);
    expect(actionIds(blocks)).toContain("jam_vote_skip");
    expect(rendered(blocks)).toContain("matched by title");
    expect(rendered(blocks)).toContain("(2/3)");
  });

  it("renders a tab nav row once a second tab has content", () => {
    const state = baseState({ knowledge, links });
    const { blocks } = renderTrackCard(state);
    const ids = actionIds(blocks);
    expect(ids).toContain(`${CARD_TAB_ACTION}:credits`);
    expect(ids).toContain(`${CARD_TAB_ACTION}:links`);
    // Context wasn't provided, so no context tab.
    expect(ids).not.toContain(`${CARD_TAB_ACTION}:context`);
  });

  it("credits view hyperlinks ids, keeps name-only plain, and buttons only id-carriers", () => {
    const state = baseState({
      knowledge,
      view: { kind: "tab", tab: "credits" },
    });
    const { blocks } = renderTrackCard(state);
    const json = rendered(blocks);
    // Producer with an artistId is hyperlinked to MusicBrainz.
    expect(json).toContain("musicbrainz.org/artist/art-jmj");
    // Performer without an artistId appears as plain text.
    expect(json).toContain("Anthony Gonzalez");

    // One explore button — only the id-carrying producer, not the name-only one.
    const btns = personButtons(blocks);
    expect(btns).toHaveLength(1);
    expect(btns[0].value).toBe("art-jmj");
    expect(btns[0].text.text).toContain("Justin Meldal-Johnsen");
    // Short list: no dropdown.
    expect(actionIds(blocks)).not.toContain(CARD_PERSON_ACTION);
  });

  it("renders nothing explorable when no credit carries an artist id", () => {
    const state = baseState({
      knowledge: {
        recordingId: "rec1",
        approximate: false,
        personnel: [{ role: "guitar", name: "Unknown Session Player" }],
      },
      view: { kind: "tab", tab: "credits" },
    });
    const { blocks } = renderTrackCard(state);
    expect(personButtons(blocks)).toHaveLength(0);
    expect(actionIds(blocks)).not.toContain(CARD_PERSON_ACTION);
    // The name still shows as plain text.
    expect(rendered(blocks)).toContain("Unknown Session Player");
  });

  it("falls back to a dropdown when the explorable list is long", () => {
    const many = Array.from({ length: PERSON_BUTTON_MAX + 1 }, (_, i) => ({
      role: "performer",
      name: `Player ${i}`,
      artistId: `art-${i}`,
    }));
    const state = baseState({
      knowledge: { recordingId: "rec1", approximate: false, personnel: many },
      view: { kind: "tab", tab: "credits" },
    });
    const { blocks } = renderTrackCard(state);
    // Past the cap: a single dropdown, no per-person buttons.
    expect(actionIds(blocks)).toContain(CARD_PERSON_ACTION);
    expect(personButtons(blocks)).toHaveLength(0);
  });

  it("chunks person buttons into rows of at most five", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      role: "performer",
      name: `Player ${i}`,
      artistId: `art-${i}`,
    }));
    const state = baseState({
      knowledge: { recordingId: "rec1", approximate: false, personnel: seven },
      view: { kind: "tab", tab: "credits" },
    });
    const { blocks } = renderTrackCard(state);
    expect(personButtons(blocks)).toHaveLength(7);
    // No single actions block exceeds Slack's 5-element cap.
    for (const b of blocks as Array<{ type: string; elements?: unknown[] }>) {
      if (b.type === "actions") expect((b.elements ?? []).length).toBeLessThanOrEqual(5);
    }
  });

  it("links view lists platforms and the all-platforms page", () => {
    const state = baseState({ links, view: { kind: "tab", tab: "links" } });
    const json = rendered(renderTrackCard(state).blocks);
    expect(json).toContain("Apple Music");
    expect(json).toContain("song.link/s/abc");
  });

  it("person sub-page shows a back button and grounded info; falls back while loading", () => {
    const loading = baseState({
      knowledge,
      view: { kind: "person", artistId: "art-jmj", from: "credits" },
    });
    const loadingJson = rendered(renderTrackCard(loading).blocks);
    expect(loadingJson).toContain("Looking up");
    expect(actionIds(renderTrackCard(loading).blocks)).toContain(CARD_BACK_ACTION);

    const loaded = baseState({
      knowledge,
      view: { kind: "person", artistId: "art-jmj", from: "credits" },
      people: new Map([
        [
          "art-jmj",
          {
            name: "Justin Meldal-Johnsen",
            artistId: "art-jmj",
            mbUrl: "https://musicbrainz.org/artist/art-jmj",
            knownFor: [
              { title: "Some Album", year: 2011, mbUrl: "https://mb/rg/1" },
            ],
            tags: ["producer"],
            bio: "A bassist and producer.",
            wikipediaUrl: "https://en.wikipedia.org/wiki/JMJ",
            fetchedAtMs: 0,
          },
        ],
      ]),
    });
    const loadedJson = rendered(renderTrackCard(loaded).blocks);
    expect(loadedJson).toContain("Some Album");
    expect(loadedJson).toContain("A bassist and producer");
    expect(loadedJson).not.toContain("Looking up");
  });

  it("falls back to the now view when the selected tab lost its content", () => {
    const state = baseState({ view: { kind: "tab", tab: "credits" } });
    // No knowledge -> credits view empty -> render now.
    expect(rendered(renderTrackCard(state).blocks)).toContain("Now playing");
  });
});

describe("track-card registry", () => {
  beforeEach(() => clearCards());

  it("stores and retrieves by channel:ts", () => {
    const s = baseState();
    putCard(s);
    expect(getCard(cardKey("C1", "1.1"))).toBe(s);
    deleteCard(cardKey("C1", "1.1"));
    expect(getCard(cardKey("C1", "1.1"))).toBeUndefined();
  });

  it("evicts the oldest once over capacity", () => {
    for (let i = 0; i < 90; i++) {
      putCard(baseState({ channel: "C", ts: String(i) }));
    }
    // The very first inserts should have been evicted.
    expect(getCard(cardKey("C", "0"))).toBeUndefined();
    // The most recent survive.
    expect(getCard(cardKey("C", "89"))).toBeDefined();
  });
});
