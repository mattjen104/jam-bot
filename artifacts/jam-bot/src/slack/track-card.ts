import type { KnownBlock } from "@slack/types";
import type { CurrentlyPlaying } from "../spotify/client.js";
import { VOTE_SKIP_ACTION_ID, type VoteSkipState } from "./format.js";
import {
  type TrackKnowledge,
  groupPersonnel,
  relationshipLines,
} from "../turntable/knowledge.js";
import type { TrackContext } from "../turntable/context.js";
import {
  type ArtistCatalogue,
  catalogueHasContent,
} from "../turntable/catalogue.js";
import type { Credit } from "../turntable/musicbrainz.js";
import type { TrackLinks } from "../turntable/odesli.js";
import type { PersonInfo } from "../turntable/person.js";
import type { TurntableSource } from "../turntable/session.js";

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
// Each explorable person is its own button (action_id suffixed with an index so
// every element is unique), but a long credit list falls back to a single
// dropdown. Both shapes carry the artist id and route through one handler, which
// the bot registers with CARD_PERSON_ACTION_RE.
export const CARD_PERSON_ACTION_RE = new RegExp(`^${CARD_PERSON_ACTION}(?::|$)`);
/** At or below this many explorable people, render buttons; above, a dropdown. */
export const PERSON_BUTTON_MAX = 10;

// Hop from a person to a grounded collaborator (action_id suffixed with an index
// for uniqueness; value carries the collaborator's artist id).
export const CARD_HOP_ACTION = "jam_card_hop";
export const CARD_HOP_ACTION_RE = new RegExp(`^${CARD_HOP_ACTION}:`);
// Breadcrumb crumbs: ":tab" returns to the originating tab; ":<index>" jumps to
// that level in the person trail.
export const CARD_CRUMB_ACTION = "jam_card_crumb";
export const CARD_CRUMB_ACTION_RE = new RegExp(`^${CARD_CRUMB_ACTION}:`);
// "Play their sessions": queue a capped handful of this person's notable work
// onto the host playback. Single action; value carries the person's artist id.
export const CARD_SESSIONS_ACTION = "jam_card_sessions";
// Catalogue (Context tab): queue one of the artist's top tracks. Each button's
// action_id is suffixed with an index for uniqueness; value carries the Spotify
// track URI. The bot registers the handler with CARD_QUEUE_ACTION_RE.
export const CARD_QUEUE_ACTION = "jam_card_queue";
export const CARD_QUEUE_ACTION_RE = new RegExp(`^${CARD_QUEUE_ACTION}:`);
// Catalogue (Context tab): queue an album via dropdown; value carries the
// Spotify album id.
export const CARD_ALBUM_ACTION = "jam_card_album";
/**
 * How many top-track quick-queue buttons the catalogue shows. Rendered 5 per
 * Slack actions block (its element cap), so 10 → two navigable rows.
 */
export const CATALOGUE_TRACK_BUTTONS = 10;
/** How many albums the catalogue dropdown lists. */
export const CATALOGUE_ALBUM_OPTIONS = 24;
/**
 * Max people kept in a hop trail. Bounds the breadcrumb so it (plus the leading
 * tab crumb) never exceeds Slack's 5-element actions-row cap, and keeps the trail
 * readable. Pushing past it slides the window, dropping the oldest person.
 */
export const MAX_PERSON_DEPTH = 4;

export type CardTab = "now" | "credits" | "context" | "links";

export type CardView =
  | { kind: "tab"; tab: CardTab }
  | { kind: "person"; trail: string[]; from: CardTab };

type PersonView = Extract<CardView, { kind: "person" }>;

/**
 * Push a person onto a hop trail, sliding the window so the trail never exceeds
 * MAX_PERSON_DEPTH (the oldest person drops off). Keeps the breadcrumb bounded.
 */
export function pushPersonTrail(trail: string[], artistId: string): string[] {
  const next = [...trail, artistId];
  return next.length > MAX_PERSON_DEPTH
    ? next.slice(next.length - MAX_PERSON_DEPTH)
    : next;
}

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
  /**
   * For turntable cards: whether the Jam is following a physical record or the
   * computer's own audio. Defaults to "record" when absent so older callers
   * (and non-turntable sources) keep their original look.
   */
  turntableSource?: TurntableSource;
  /** Present only on the channel card that backs vote-skip. */
  vote?: VoteSkipState;
  knowledge?: TrackKnowledge | null;
  knowledgeSummary?: string | null;
  context?: TrackContext | null;
  contextSummary?: string | null;
  /** Artist's playable catalogue (top tracks + albums) for the Context tab. */
  catalogue?: ArtistCatalogue | null;
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
  return (
    !!k &&
    (k.personnel.length > 0 ||
      !!k.pressing ||
      (k.relationships?.length ?? 0) > 0)
  );
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

/**
 * The Context tab shows only when it has something we actually RENDER: the
 * playable catalogue, a genre tag, or a Genius link. The old artist Wikipedia
 * bio is deliberately excluded — `contextHasContent` still counts it, but we no
 * longer render it, so gating on it would surface a near-empty tab.
 */
function contextTabHasContent(state: TrackCardState): boolean {
  if (catalogueHasContent(state.catalogue)) return true;
  const c = state.context;
  return !!c && ((c.tags?.length ?? 0) > 0 || !!c.geniusUrl);
}

function availableTabs(state: TrackCardState): CardTab[] {
  const tabs: CardTab[] = ["now"];
  if (knowledgeHasContent(state.knowledge)) tabs.push("credits");
  if (contextTabHasContent(state)) tabs.push("context");
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
  const sourceNote =
    source === "turntable"
      ? `\n_Following ${
          state.turntableSource === "computer" ? "computer audio" : "a record"
        }_`
      : "";
  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${header}\n*<${track.spotifyUrl}|${track.title}>*\n${track.artist}\n_${track.album}_  •  ${fmtMs(track.durationMs)}${requesterLine}${matchNote}${sourceNote}`,
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

  // Liner content present only when we added a credit/pressing line beyond the
  // header (+ optional summary). A track with relationships but no credits skips
  // the liner-notes section and shows just the connections section below.
  const minLines = state.knowledgeSummary?.trim() ? 2 : 1;
  const blocks: KnownBlock[] = [];
  if (lines.length > minLines) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
    // Explore — only people we have a canonical artist id for, so every
    // drill-down is grounded (no name-search guessing). A short list renders as
    // a button per person; a long one falls back to a single dropdown.
    blocks.push(...exploreBlocks(uniqueExplorable(k.personnel)));
  }

  // Compact, typed song-to-song relationships (samples / covers / remixes /
  // interpolations) when present — silent otherwise.
  const relLines = relationshipLines(k.relationships);
  if (relLines.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: relLines.join("\n") },
    });
  }
  return blocks;
}

/**
 * Render the "explore a person" affordance for the credits view. Each explorable
 * person becomes a tappable button (grouped into Slack's 5-per-row action
 * blocks); past PERSON_BUTTON_MAX it collapses to a single dropdown so big
 * sessions never overflow the card. Returns [] when no one is explorable.
 */
function exploreBlocks(explorable: Credit[]): KnownBlock[] {
  if (!explorable.length) return [];

  if (explorable.length > PERSON_BUTTON_MAX) {
    return [
      {
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
      },
    ];
  }

  const buttons = explorable.map((c, i) => ({
    type: "button" as const,
    action_id: `${CARD_PERSON_ACTION}:${i}`,
    text: {
      type: "plain_text" as const,
      text: truncate(`:mag: ${c.name}`, 75),
      emoji: true,
    },
    value: c.artistId!,
  }));

  // Slack caps an actions block at 5 elements, so chunk into rows.
  const rows: KnownBlock[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: "actions", elements: buttons.slice(i, i + 5) });
  }
  return rows;
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

/** Plain (un-linked) credited names, for a readable prose blurb. */
function plainNames(credits: Credit[]): string {
  return credits.map((c) => c.name).join(", ");
}

/**
 * The short, SONG-specific blurb at the top of the Context tab. Built only from
 * facts we already have — the album this track is on, its top genre tag, and its
 * real writers/producers — so it changes per song instead of repeating the same
 * artist bio on every card, and can never fabricate. Returns [] when there's
 * nothing song-specific to say.
 */
function songBlurbLines(state: TrackCardState): string[] {
  const lines: string[] = [];
  const album = state.track.album?.trim();
  const topTag = state.context?.tags?.[0];
  const title = state.track.title;
  const intro =
    topTag && album
      ? `*“${title}”* — a ${topTag} track from *${album}*.`
      : album
        ? `*“${title}”* — from *${album}*.`
        : topTag
          ? `*“${title}”* — ${topTag}.`
          : "";
  if (intro) lines.push(intro);

  const k = state.knowledge;
  if (k && knowledgeHasContent(k)) {
    const { producers, writers } = groupPersonnel(k.personnel);
    const credit: string[] = [];
    if (writers.length) credit.push(`Written by ${plainNames(writers)}`);
    if (producers.length) credit.push(`produced by ${plainNames(producers)}`);
    if (credit.length) lines.push(`${credit.join(", ")}.`);
  }
  return lines;
}

/**
 * The navigable, queueable catalogue: the artist's top tracks as one-tap queue
 * buttons (chunked into Slack's 5-per-row actions blocks) plus a dropdown that
 * queues a full album. Returns [] when there's no catalogue to show.
 */
function catalogueBlocks(state: TrackCardState): KnownBlock[] {
  const cat = state.catalogue;
  if (!catalogueHasContent(cat) || !cat) return [];

  const blocks: KnownBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:notes: *More from <${cat.artistUrl}|${cat.artistName}>*`,
      },
    },
  ];

  const tracks = cat.topTracks.slice(0, CATALOGUE_TRACK_BUTTONS);
  if (tracks.length) {
    const buttons = tracks.map((t, i) => ({
      type: "button" as const,
      action_id: `${CARD_QUEUE_ACTION}:${i}`,
      text: {
        type: "plain_text" as const,
        text: truncate(`:arrow_forward: ${t.title}`, 75),
        emoji: true,
      },
      value: t.uri,
    }));
    // Slack caps an actions block at 5 elements, so chunk into rows.
    for (let i = 0; i < buttons.length; i += 5) {
      blocks.push({ type: "actions", elements: buttons.slice(i, i + 5) });
    }
  }

  const albums = cat.albums.slice(0, CATALOGUE_ALBUM_OPTIONS);
  if (albums.length) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "static_select",
          action_id: CARD_ALBUM_ACTION,
          placeholder: {
            type: "plain_text",
            text: ":cd: Queue an album…",
            emoji: true,
          },
          options: albums.map((a) => ({
            text: {
              type: "plain_text",
              text: truncate(a.year ? `${a.name} (${a.year})` : a.name, 75),
              emoji: true,
            },
            value: a.id,
          })),
        },
      ],
    });
  }
  return blocks;
}

/**
 * The whole Context tab: a song-specific blurb up top, then the genre + lyrics
 * line, then the navigable catalogue. Deliberately omits the old artist-level
 * Wikipedia bio (it repeated on every track and often resolved to the wrong
 * page); the catalogue is the actionable, song-relevant replacement.
 */
function contextViewBlocks(state: TrackCardState): KnownBlock[] {
  const lines: string[] = [":headphones: *Genre & context*"];
  lines.push(...songBlurbLines(state));

  const c = state.context;
  if (c?.tags?.length) lines.push(`*Genre:* ${c.tags.join(" · ")}`);
  if (c?.geniusUrl) {
    const note = c.approximate ? " _(matched by title)_" : "";
    lines.push(`*Lyrics:* <${c.geniusUrl}|Genius>${note}`);
  }

  const blocks: KnownBlock[] = [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  blocks.push(...catalogueBlocks(state));
  return blocks;
}

/** A display name for a trail person, resolvable even before enrichment loads. */
function personName(state: TrackCardState, artistId: string): string {
  const info = state.people.get(artistId);
  if (info?.name && info.name !== "this person") return info.name;
  const credit = state.knowledge?.personnel.find((c) => c.artistId === artistId);
  if (credit?.name) return credit.name;
  // Fall back to a parent's collaborator list (the button we hopped from carries
  // the name before that person's own page has been fetched).
  for (const cached of state.people.values()) {
    const hit = cached?.collaborators?.find((c) => c.artistId === artistId);
    if (hit) return hit.name;
  }
  return info?.name ?? "this person";
}

/**
 * Clickable breadcrumb: a leading crumb back to the originating tab, then one
 * crumb per person in the trail (the current person highlighted). Each crumb is
 * a button — Slack has no native breadcrumb. Bounded by MAX_PERSON_DEPTH so the
 * row stays within Slack's 5-element cap.
 */
function breadcrumbRow(state: TrackCardState, view: PersonView): KnownBlock {
  const elements: Array<{
    type: "button";
    action_id: string;
    text: { type: "plain_text"; text: string; emoji: boolean };
    value: string;
    style?: "primary";
  }> = [
    {
      type: "button",
      action_id: `${CARD_CRUMB_ACTION}:tab`,
      text: {
        type: "plain_text",
        text: truncate(TAB_LABELS[view.from], 24),
        emoji: true,
      },
      value: view.from,
    },
  ];
  view.trail.forEach((id, i) => {
    const el: (typeof elements)[number] = {
      type: "button",
      action_id: `${CARD_CRUMB_ACTION}:${i}`,
      text: {
        type: "plain_text",
        text: truncate(personName(state, id), 24),
        emoji: true,
      },
      value: String(i),
    };
    if (i === view.trail.length - 1) el.style = "primary";
    elements.push(el);
  });
  return { type: "actions", elements };
}

/** Grounded collaborator hop buttons (each carries a canonical artist id). */
function collaboratorBlocks(info: PersonInfo | null): KnownBlock[] {
  const collabs = (info?.collaborators ?? []).filter((c) => c.artistId);
  if (!collabs.length) return [];
  const buttons = collabs.slice(0, PERSON_BUTTON_MAX).map((c, i) => ({
    type: "button" as const,
    action_id: `${CARD_HOP_ACTION}:${i}`,
    text: {
      type: "plain_text" as const,
      text: truncate(`:arrow_right: ${c.name}`, 75),
      emoji: true,
    },
    value: c.artistId,
  }));
  const rows: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: ":busts_in_silhouette: *Explore collaborators*" },
    },
  ];
  // Slack caps an actions block at 5 elements, so chunk into rows.
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push({ type: "actions", elements: buttons.slice(i, i + 5) });
  }
  return rows;
}

function personViewBlocks(state: TrackCardState): KnownBlock[] {
  if (state.view.kind !== "person") return [];
  const view = state.view;
  const artistId = view.trail[view.trail.length - 1];
  if (!artistId) return [];
  const fetched = state.people.has(artistId);
  const info = state.people.get(artistId) ?? null;
  const credit = state.knowledge?.personnel.find((c) => c.artistId === artistId);
  const name = personName(state, artistId);
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

  const controls: Array<{
    type: "button";
    action_id: string;
    text: { type: "plain_text"; text: string; emoji: boolean };
    value: string;
    style?: "primary" | "danger";
  }> = [];
  // Only offer "Play their sessions" when there's notable work to resolve, so
  // the card never advertises an action that can't queue anything.
  if ((info?.knownFor?.length ?? 0) > 0) {
    controls.push({
      type: "button",
      action_id: CARD_SESSIONS_ACTION,
      text: { type: "plain_text", text: ":notes: Play their sessions", emoji: true },
      value: artistId,
      style: "primary",
    });
  }
  controls.push({
    type: "button",
    action_id: CARD_BACK_ACTION,
    text: { type: "plain_text", text: ":arrow_left: Back", emoji: true },
    value: view.from,
  });

  return [
    breadcrumbRow(state, view),
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    ...collaboratorBlocks(info),
    { type: "actions", elements: controls },
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
        body = contextViewBlocks(state);
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
