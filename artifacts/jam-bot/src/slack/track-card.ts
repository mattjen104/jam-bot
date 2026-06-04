import type { KnownBlock } from "@slack/types";
import type { CurrentlyPlaying } from "../spotify/client.js";
import { VOTE_SKIP_ACTION_ID, type VoteSkipState } from "./format.js";
import { type TrackKnowledge, groupPersonnel } from "../turntable/knowledge.js";
import { contextBlocks, type TrackContext } from "../turntable/context.js";
import type { Credit } from "../turntable/musicbrainz.js";
import type { TrackLinks } from "../turntable/odesli.js";
import type { PersonInfo } from "../turntable/person.js";

/**
 * The consolidated track card: ONE in-chat Block Kit message per track with
 * button-driven tabs (Now Playing / Liner Notes / Context / Links) and a person
 * rabbit-hole sub-page, all updated in place via chat.update. This replaces the
 * three separate messages (now-playing + liner-notes + context) the bot used to
 * post per track.
 *
 * This module is PURE rendering + an in-memory registry of live cards. All the
 * fetching (enrichment, person lookups) lives in the Slack bot, which owns the
 * Slack client; here we only turn card state into blocks and remember which
 * message a card lives on so an interaction can find and re-render it.
 */

// Tab buttons all route through one logical action, but Slack requires a unique
// action_id per element in a message, so each tab button's action_id is
// suffixed with the tab name. The bot registers the handler with TAB_ACTION_RE.
export const CARD_TAB_ACTION = "jam_card_tab";
export const CARD_PERSON_ACTION = "jam_card_person";
export const CARD_BACK_ACTION = "jam_card_back";
export const TAB_ACTION_RE = new RegExp(`^${CARD_TAB_ACTION}:`);

export type CardTab = "now" | "credits" | "context" | "links";

export type CardView =
  | { kind: "tab"; tab: CardTab }
  | { kind: "person"; artistId: string; from: CardTab };

/** Where the card came from — drives the Now Playing header + honesty note. */
export type CardSource = "jam" | "turntable" | "tour";

export type CardTrack = NonNullable<CurrentlyPlaying["track"]>;

export interface TrackCardState {
  channel: string;
  ts: string;
  source: CardSource;
  track: CardTrack;
  requestedBy: string | null;
  requestedQuery: string | null;
  viaIsrc: boolean;
  /** Present only on the channel card that backs vote-skip. */
  vote?: VoteSkipState;
  knowledge?: TrackKnowledge | null;
  knowledgeSummary?: string | null;
  context?: TrackContext | null;
  contextSummary?: string | null;
  links?: TrackLinks | null;
  view: CardView;
  /** Lazily-populated person sub-page cache, keyed by MusicBrainz artist id. */
  people: Map<string, PersonInfo | null>;
}

function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function mbArtistUrl(id: string): string {
  return `https://musicbrainz.org/artist/${id}`;
}

// ---- content presence -----------------------------------------------------

export function knowledgeHasContent(k?: TrackKnowledge | null): boolean {
  return !!k && (k.personnel.length > 0 || !!k.pressing);
}

export function contextHasContent(c?: TrackContext | null): boolean {
  return (
    !!c &&
    (c.tags.length > 0 ||
      c.similarArtists.length > 0 ||
      !!c.bio ||
      !!c.geniusUrl)
  );
}

export function linksHasContent(l?: TrackLinks | null): boolean {
  return !!l && (l.platforms.length > 0 || !!l.pageUrl);
}

function availableTabs(state: TrackCardState): CardTab[] {
  const tabs: CardTab[] = ["now"];
  if (knowledgeHasContent(state.knowledge)) tabs.push("credits");
  if (contextHasContent(state.context)) tabs.push("context");
  if (linksHasContent(state.links)) tabs.push("links");
  return tabs;
}

const TAB_LABELS: Record<CardTab, string> = {
  now: "Now Playing",
  credits: "Liner Notes",
  context: "Context",
  links: "Links",
};

// ---- per-view bodies ------------------------------------------------------

function nowViewBlocks(state: TrackCardState): KnownBlock[] {
  const { track, source } = state;
  const header =
    source === "turntable"
      ? ":record_button: *Now playing from the turntable*"
      : ":notes: *Now playing*";
  const requesterLine = state.requestedBy
    ? `\n_Requested by <@${state.requestedBy}>${
        state.requestedQuery ? ` — "${state.requestedQuery}"` : ""
      }_`
    : "";
  const matchNote =
    source === "turntable" && !state.viaIsrc
      ? "\n_(matched by title — couldn't confirm the exact pressing)_"
      : "";
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${header}\n*<${track.spotifyUrl}|${track.title}>*\n${track.artist}\n_${track.album}_  •  ${fmtMs(track.durationMs)}${requesterLine}${matchNote}`,
      },
      ...(track.albumImageUrl
        ? {
            accessory: {
              type: "image",
              image_url: track.albumImageUrl,
              alt_text: track.album,
            },
          }
        : {}),
    },
  ];
  if (state.vote) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: VOTE_SKIP_ACTION_ID,
          text: {
            type: "plain_text",
            text: `:next_track: Vote skip (${state.vote.count}/${state.vote.threshold})`,
            emoji: true,
          },
          value: track.id,
        },
      ],
    });
  }
  return blocks;
}

/** Render a list of credited names, hyperlinking any with an artist id. */
function renderNames(credits: Credit[]): string {
  return credits
    .map((c) => (c.artistId ? `<${mbArtistUrl(c.artistId)}|${c.name}>` : c.name))
    .join(", ");
}

function renderPlayers(credits: Credit[]): string {
  return credits
    .map((c) => {
      const nm = c.artistId
        ? `<${mbArtistUrl(c.artistId)}|${c.name}>`
        : c.name;
      return `${nm} (${c.role})`;
    })
    .join(", ");
}

function creditsViewBlocks(state: TrackCardState): KnownBlock[] {
  const k = state.knowledge;
  if (!knowledgeHasContent(k) || !k) return [];
  const lines: string[] = [];
  lines.push(
    `:notebook_with_decorative_cover: *Liner notes*` +
      (k.approximate
        ? " _(pressing-level — may not match this exact recording)_"
        : ""),
  );
  if (state.knowledgeSummary?.trim()) {
    lines.push(`_${state.knowledgeSummary.trim()}_`);
  }
  const { producers, writers, engineers, performers } = groupPersonnel(
    k.personnel,
  );
  if (producers.length) lines.push(`*Produced by:* ${renderNames(producers)}`);
  if (writers.length) lines.push(`*Written by:* ${renderNames(writers)}`);
  if (engineers.length) lines.push(`*Engineering:* ${renderNames(engineers)}`);
  if (performers.length) lines.push(`*Players:* ${renderPlayers(performers)}`);

  const p = k.pressing;
  if (p) {
    const parts = [p.label, p.year ? String(p.year) : null, p.country, p.format]
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter(Boolean);
    if (parts.length) lines.push(`*Pressing:* ${parts.join(" · ")}`);
  }

  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];

  // Explore-a-person menu — only people we have a canonical artist id for, so
  // every drill-down is grounded (no name-search guessing).
  const explorable = uniqueExplorable(k.personnel);
  if (explorable.length) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: CARD_PERSON_ACTION,
          placeholder: {
            type: "plain_text",
            text: ":mag: Explore a person",
            emoji: true,
          },
          options: explorable.slice(0, 25).map((c) => ({
            text: {
              type: "plain_text",
              text: truncate(`${c.name} — ${c.role}`, 75),
              emoji: true,
            },
            value: c.artistId!,
          })),
        },
      ],
    });
  }
  return blocks;
}

/** Distinct credited people that carry an artist id, first role wins. */
function uniqueExplorable(personnel: Credit[]): Credit[] {
  const out: Credit[] = [];
  const seen = new Set<string>();
  for (const c of personnel) {
    if (!c.artistId || seen.has(c.artistId)) continue;
    seen.add(c.artistId);
    out.push(c);
  }
  return out;
}

function linksViewBlocks(state: TrackCardState): KnownBlock[] {
  const l = state.links;
  if (!linksHasContent(l) || !l) return [];
  const lines: string[] = [":link: *Listen elsewhere*"];
  if (l.platforms.length) {
    lines.push(l.platforms.map((p) => `<${p.url}|${p.name}>`).join("  ·  "));
  }
  if (l.pageUrl) lines.push(`<${l.pageUrl}|All platforms ↗>`);
  return [{ type: "section", text: { type: "mrkdwn", text: lines.join("\n") } }];
}

function personViewBlocks(state: TrackCardState): KnownBlock[] {
  if (state.view.kind !== "person") return [];
  const { artistId, from } = state.view;
  const fetched = state.people.has(artistId);
  const info = state.people.get(artistId) ?? null;
  const credit = state.knowledge?.personnel.find((c) => c.artistId === artistId);
  const name = info?.name ?? credit?.name ?? "this person";
  const roleLine = credit
    ? `_${credit.role} on “${state.track.title}”_`
    : undefined;

  const lines: string[] = [`:bust_in_silhouette: *${name}*`];
  if (roleLine) lines.push(roleLine);

  if (!fetched) {
    lines.push("_Looking up…_");
  } else if (!info) {
    lines.push("_Couldn't find more about this person right now._");
  } else {
    if (info.bio?.trim()) {
      const bio = truncate(info.bio.trim(), 600);
      lines.push(info.wikipediaUrl ? `${bio} <${info.wikipediaUrl}|(Wikipedia)>` : bio);
    }
    if (info.tags.length) lines.push(`*Genre:* ${info.tags.join(" · ")}`);
    if (info.knownFor.length) {
      const items = info.knownFor
        .map((r) => `<${r.mbUrl}|${r.title}>${r.year ? ` (${r.year})` : ""}`)
        .join("  ·  ");
      lines.push(`*Known for:* ${items}`);
    }
    if (info.mbUrl) lines.push(`<${info.mbUrl}|Full discography on MusicBrainz ↗>`);
  }

  return [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: CARD_BACK_ACTION,
          text: { type: "plain_text", text: ":arrow_left: Back", emoji: true },
          value: from,
        },
      ],
    },
  ];
}

function tabNavRow(state: TrackCardState): KnownBlock | null {
  const tabs = availableTabs(state);
  if (tabs.length <= 1) return null;
  const activeTab = state.view.kind === "tab" ? state.view.tab : null;
  return {
    type: "actions",
    elements: tabs.map((tab) => {
      const active = tab === activeTab;
      const el: {
        type: "button";
        action_id: string;
        text: { type: "plain_text"; text: string; emoji: boolean };
        value: string;
        style?: "primary";
      } = {
        type: "button",
        action_id: `${CARD_TAB_ACTION}:${tab}`,
        text: {
          type: "plain_text",
          text: `${active ? "• " : ""}${TAB_LABELS[tab]}`,
          emoji: true,
        },
        value: tab,
      };
      if (active) el.style = "primary";
      return el;
    }),
  };
}

function truncate(s: string, max = 280): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** Plain-text fallback for notifications + accessibility. */
export function cardFallbackText(state: TrackCardState): string {
  const base = `${state.track.title} by ${state.track.artist}`;
  return state.source === "turntable"
    ? `Now playing from the turntable: ${base}`
    : `Now playing: ${base}`;
}

/**
 * Render the whole card for its current view. The person sub-page hides the tab
 * nav (it has its own Back button); every tab view shows the nav row when more
 * than one tab is available.
 */
export function renderTrackCard(state: TrackCardState): {
  blocks: KnownBlock[];
  text: string;
} {
  let body: KnownBlock[];
  if (state.view.kind === "person") {
    body = personViewBlocks(state);
  } else {
    switch (state.view.tab) {
      case "credits":
        body = creditsViewBlocks(state);
        break;
      case "context":
        body = contextBlocks(state.context!, state.contextSummary);
        break;
      case "links":
        body = linksViewBlocks(state);
        break;
      case "now":
      default:
        body = nowViewBlocks(state);
        break;
    }
    // A tab that lost its content (or an unknown view) falls back to Now Playing.
    if (!body.length) body = nowViewBlocks(state);
    const nav = tabNavRow(state);
    if (nav) body = [...body, nav];
  }
  return { blocks: body, text: cardFallbackText(state) };
}

// ---- live-card registry ---------------------------------------------------
// In-memory only: a card's interactive state lives until the bot restarts,
// exactly like vote state. After a restart an interaction on an old card finds
// no state and the handler tells the user to replay the track. Capped with
// simple insertion-order eviction so long-running sessions don't leak.

const MAX_CARDS = 80;
const cards = new Map<string, TrackCardState>();

export function cardKey(channel: string, ts: string): string {
  return `${channel}:${ts}`;
}

export function putCard(state: TrackCardState): void {
  const key = cardKey(state.channel, state.ts);
  cards.delete(key);
  cards.set(key, state);
  while (cards.size > MAX_CARDS) {
    const oldest = cards.keys().next().value;
    if (oldest === undefined) break;
    cards.delete(oldest);
  }
}

export function getCard(key: string): TrackCardState | undefined {
  return cards.get(key);
}

export function deleteCard(key: string): void {
  cards.delete(key);
}

/** Test/maintenance helper. */
export function clearCards(): void {
  cards.clear();
}
