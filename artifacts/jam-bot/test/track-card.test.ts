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
  CARD_HOP_ACTION,
  CARD_CRUMB_ACTION,
  CARD_SESSIONS_ACTION,
  PERSON_BUTTON_MAX,
  MAX_PERSON_DEPTH,
  pushPersonTrail,
  type TrackCardState,
  type CardTrack,
} from "../src/slack/track-card.js";
import type { PersonInfo } from "../src/turntable/person.js";
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

function personInfo(overrides: Partial<PersonInfo> = {}): PersonInfo {
  return {
    name: "Someone",
    knownFor: [],
    tags: [],
    collaborators: [],
    fetchedAtMs: 0,
    ...overrides,
  };
}

/** Buttons whose action_id starts with the given prefix; returns id+value+text. */
function buttonsWithPrefix(
  blocks: unknown[],
  prefix: string,
): Array<{ action_id: string; value: string; text: string; style?: string }> {
  const out: Array<{
    action_id: string;
    value: string;
    text: string;
    style?: string;
  }> = [];
  for (const b of blocks as Array<{
    elements?: Array<{
      type?: string;
      action_id?: string;
      value?: string;
      style?: string;
      text?: { text?: string };
    }>;
  }>) {
    for (const el of b.elements ?? []) {
      if (el.type === "button" && el.action_id?.startsWith(prefix)) {
        out.push({
          action_id: el.action_id,
          value: el.value ?? "",
          text: el.text?.text ?? "",
          style: el.style,
        });
      }
    }
  }
  return out;
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
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
    });
    const loadingJson = rendered(renderTrackCard(loading).blocks);
    expect(loadingJson).toContain("Looking up");
    expect(actionIds(renderTrackCard(loading).blocks)).toContain(CARD_BACK_ACTION);

    const loaded = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        [
          "art-jmj",
          personInfo({
            name: "Justin Meldal-Johnsen",
            artistId: "art-jmj",
            mbUrl: "https://musicbrainz.org/artist/art-jmj",
            knownFor: [
              { title: "Some Album", year: 2011, mbUrl: "https://mb/rg/1" },
            ],
            tags: ["producer"],
            bio: "A bassist and producer.",
            wikipediaUrl: "https://en.wikipedia.org/wiki/JMJ",
          }),
        ],
      ]),
    });
    const loadedJson = rendered(renderTrackCard(loaded).blocks);
    expect(loadedJson).toContain("Some Album");
    expect(loadedJson).toContain("A bassist and producer");
    expect(loadedJson).not.toContain("Looking up");
  });

  it("person sub-page renders a breadcrumb: a tab crumb then the current person", () => {
    const state = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        ["art-jmj", personInfo({ name: "Justin Meldal-Johnsen", artistId: "art-jmj" })],
      ]),
    });
    const crumbs = buttonsWithPrefix(renderTrackCard(state).blocks, CARD_CRUMB_ACTION);
    // Tab crumb (back to Liner Notes) + the current person crumb.
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].action_id).toBe(`${CARD_CRUMB_ACTION}:tab`);
    expect(crumbs[0].value).toBe("credits");
    expect(crumbs[1].action_id).toBe(`${CARD_CRUMB_ACTION}:0`);
    // Current person is highlighted.
    expect(crumbs[1].style).toBe("primary");
    expect(crumbs[1].text).toContain("Justin Meldal-Johnsen");
  });

  it("surfaces grounded collaborators as hop buttons carrying their artist id", () => {
    const state = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        [
          "art-jmj",
          personInfo({
            name: "Justin Meldal-Johnsen",
            artistId: "art-jmj",
            mbUrl: "https://musicbrainz.org/artist/art-jmj",
            collaborators: [
              { artistId: "art-beck", name: "Beck", relation: "member of band" },
              { artistId: "art-ngrr", name: "Nine Inch Nails" },
            ],
          }),
        ],
      ]),
    });
    const hops = buttonsWithPrefix(renderTrackCard(state).blocks, CARD_HOP_ACTION);
    expect(hops).toHaveLength(2);
    expect(hops.map((h) => h.value)).toEqual(["art-beck", "art-ngrr"]);
    expect(hops[0].text).toContain("Beck");
  });

  it("offers 'Play their sessions' carrying the artist id once known work is loaded", () => {
    const state = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        [
          "art-jmj",
          personInfo({
            name: "Justin Meldal-Johnsen",
            artistId: "art-jmj",
            knownFor: [{ title: "Some Album", year: 2011, mbUrl: "https://mb/rg/1" }],
          }),
        ],
      ]),
    });
    const sessions = buttonsWithPrefix(renderTrackCard(state).blocks, CARD_SESSIONS_ACTION);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].value).toBe("art-jmj");
    expect(sessions[0].text).toContain("Play their sessions");
  });

  it("hides 'Play their sessions' when the person has no resolvable known work", () => {
    const loading = baseState({
      knowledge,
      // Not yet fetched -> no info -> no sessions button (only Back).
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
    });
    expect(
      buttonsWithPrefix(renderTrackCard(loading).blocks, CARD_SESSIONS_ACTION),
    ).toHaveLength(0);

    const noWork = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        ["art-jmj", personInfo({ name: "Justin Meldal-Johnsen", artistId: "art-jmj" })],
      ]),
    });
    expect(
      buttonsWithPrefix(renderTrackCard(noWork).blocks, CARD_SESSIONS_ACTION),
    ).toHaveLength(0);
  });

  it("shows no hop buttons when a person has no resolvable collaborators", () => {
    const state = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj"], from: "credits" },
      people: new Map([
        ["art-jmj", personInfo({ name: "Justin Meldal-Johnsen", artistId: "art-jmj" })],
      ]),
    });
    expect(buttonsWithPrefix(renderTrackCard(state).blocks, CARD_HOP_ACTION)).toHaveLength(0);
  });

  it("a deeper trail renders a crumb per level and resolves names from parent collaborators", () => {
    const state = baseState({
      knowledge,
      view: { kind: "person", trail: ["art-jmj", "art-beck"], from: "credits" },
      people: new Map([
        [
          "art-jmj",
          personInfo({
            name: "Justin Meldal-Johnsen",
            artistId: "art-jmj",
            // art-beck not yet fetched; its name comes from this collaborator list.
            collaborators: [{ artistId: "art-beck", name: "Beck" }],
          }),
        ],
      ]),
    });
    const blocks = renderTrackCard(state).blocks;
    const crumbs = buttonsWithPrefix(blocks, CARD_CRUMB_ACTION);
    // tab crumb + two person crumbs.
    expect(crumbs).toHaveLength(3);
    expect(crumbs[2].style).toBe("primary");
    expect(crumbs[2].text).toContain("Beck");
    // Header still shows the (not-yet-fetched) current person by name + loading.
    expect(rendered(blocks)).toContain("Beck");
    expect(rendered(blocks)).toContain("Looking up");
  });

  it("pushPersonTrail slides the window so the trail never exceeds the depth cap", () => {
    let trail: string[] = [];
    for (let i = 0; i < MAX_PERSON_DEPTH + 3; i++) {
      trail = pushPersonTrail(trail, `art-${i}`);
      expect(trail.length).toBeLessThanOrEqual(MAX_PERSON_DEPTH);
    }
    // The most recent people survive; the oldest dropped off.
    expect(trail[trail.length - 1]).toBe(`art-${MAX_PERSON_DEPTH + 2}`);
    expect(trail).not.toContain("art-0");
    // Breadcrumb (tab crumb + capped trail) stays within Slack's 5-element row.
    const state = baseState({
      view: { kind: "person", trail, from: "credits" },
      people: new Map(),
    });
    expect(buttonsWithPrefix(renderTrackCard(state).blocks, CARD_CRUMB_ACTION).length)
      .toBeLessThanOrEqual(5);
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
