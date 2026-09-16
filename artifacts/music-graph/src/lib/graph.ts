import type {
  SongContext,
  Credit,
  CatalogueAlbum,
  CatalogueTrack,
  TrackLink,
  TrackInsight,
  SongRelationship,
} from "@workspace/api-client-react";

export type NodeKind =
  | "anchor"
  | "hub"
  | "credit"
  | "genre"
  | "similar"
  | "album"
  | "track"
  | "link"
  | "insight"
  | "connection"
  | "merch";

export type HubCategory =
  | "personnel"
  | "connections"
  | "genres"
  | "similar"
  | "albums"
  | "tracks"
  | "links"
  | "insights"
  | "support";

/**
 * A commerce result that has already been verified and artist-linked by the
 * API. The graph still validates the identity and destination at its boundary
 * because this data is user-visible and may come from a stale cache.
 */
export interface MerchProduct {
  artistMbid: string;
  title: string;
  destinationUrl: string;
  imageUrl?: string | null;
  source: string;
  kind: string;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  sublabel?: string;
  category?: HubCategory;
  credit?: Credit;
  album?: CatalogueAlbum;
  track?: CatalogueTrack;
  platform?: TrackLink;
  insight?: TrackInsight;
  relationship?: SongRelationship;
  merch?: MerchProduct;
  artistName?: string;
  // mutable simulation fields
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const HUB_META: Record<HubCategory, string> = {
  personnel: "Personnel",
  connections: "Connections",
  genres: "Genres & Tags",
  similar: "Similar Artists",
  albums: "Albums",
  tracks: "Top Tracks",
  links: "Listen Elsewhere",
  insights: "Timed Notes",
  support: "Support / Buy",
};

const CAPS: Record<HubCategory, number> = {
  personnel: 16,
  connections: 16,
  genres: 14,
  similar: 12,
  albums: 12,
  tracks: 10,
  links: 12,
  insights: 24,
  support: 8,
};

export const ANCHOR_ID = "anchor";

export function formatPosition(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type ContextWithMerch = SongContext & {
  merch?: unknown;
};

type ArtistContextWithMerch = NonNullable<SongContext["context"]> & {
  merch?: unknown;
};

/**
 * Only allow links that can leave the graph for a normal public web origin.
 * The server is the source of truth for verification, but this second check
 * prevents a malformed/stale response from becoming a javascript/data link.
 */
export function safeMerchUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !host ||
      url.username ||
      url.password ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Read the merch property from either the current top-level SongContext shape
 * or the nested enrichment shape used by early API responses. Keeping this
 * boundary tolerant lets the generated API type evolve without weakening the
 * identity checks below.
 */
export function verifiedMerchForContext(context: SongContext): MerchProduct[] {
  const topLevel = context as ContextWithMerch;
  const nested = context.context as ArtistContextWithMerch | null | undefined;
  const raw = topLevel.merch ?? nested?.merch;
  if (!Array.isArray(raw)) return [];

  const artistMbid =
    nested?.artistId?.trim() || context.knowledge?.artistId?.trim() || "";
  if (!artistMbid) return [];

  const seen = new Set<string>();
  const products: MerchProduct[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const row = candidate as Partial<MerchProduct>;
    if (typeof row.artistMbid !== "string" || row.artistMbid.trim() !== artistMbid) {
      continue;
    }
    if (typeof row.title !== "string" || !row.title.trim()) continue;
    const destinationUrl = safeMerchUrl(row.destinationUrl);
    if (!destinationUrl) continue;
    const key = destinationUrl.replace(/\/+$/, "");
    if (seen.has(key)) continue;
    if (typeof row.source !== "string" || !row.source.trim()) continue;
    if (typeof row.kind !== "string" || !row.kind.trim()) continue;
    seen.add(key);
    products.push({
      artistMbid,
      title: row.title.trim(),
      destinationUrl,
      imageUrl: safeMerchUrl(row.imageUrl) ?? null,
      source: row.source.trim(),
      kind: row.kind.trim(),
    });
    if (products.length >= CAPS.support) break;
  }
  return products;
}

export function buildGraph(context: SongContext): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const seen = new Set<string>();

  const push = (node: GraphNode) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    nodes.push(node);
    return true;
  };

  push({ id: ANCHOR_ID, kind: "anchor", label: context.track.name });

  const addHub = (category: HubCategory): string => {
    const id = `hub:${category}`;
    if (!seen.has(id)) {
      push({ id, kind: "hub", label: HUB_META[category], category });
      links.push({ source: ANCHOR_ID, target: id });
    }
    return id;
  };

  const personnel = context.knowledge?.personnel ?? [];
  if (personnel.length > 0) {
    const hub = addHub("personnel");
    personnel.slice(0, CAPS.personnel).forEach((credit, i) => {
      const id = `credit:${i}:${credit.name}:${credit.role}`;
      if (push({
        id,
        kind: "credit",
        label: credit.name,
        sublabel: credit.role,
        category: "personnel",
        credit,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const relationships = context.knowledge?.relationships ?? [];
  if (relationships.length > 0) {
    const hub = addHub("connections");
    relationships.slice(0, CAPS.connections).forEach((rel, i) => {
      const id = `connection:${i}:${rel.targetId}`;
      const sublabel = [
        rel.label,
        rel.artist,
        rel.year != null ? String(rel.year) : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (push({
        id,
        kind: "connection",
        label: rel.title,
        sublabel: sublabel || undefined,
        category: "connections",
        relationship: rel,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const tags = context.context?.tags ?? [];
  if (tags.length > 0) {
    const hub = addHub("genres");
    tags.slice(0, CAPS.genres).forEach((tag, i) => {
      const id = `genre:${i}:${tag}`;
      if (push({ id, kind: "genre", label: tag, category: "genres" })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const similar = context.context?.similarArtists ?? [];
  if (similar.length > 0) {
    const hub = addHub("similar");
    similar.slice(0, CAPS.similar).forEach((name, i) => {
      const id = `similar:${i}:${name}`;
      if (push({
        id,
        kind: "similar",
        label: name,
        category: "similar",
        artistName: name,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const albums = context.catalogue?.albums ?? [];
  if (albums.length > 0) {
    const hub = addHub("albums");
    albums.slice(0, CAPS.albums).forEach((album) => {
      const id = `album:${album.id}`;
      if (push({
        id,
        kind: "album",
        label: album.name,
        sublabel: album.year != null ? String(album.year) : undefined,
        category: "albums",
        album,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const topTracks = context.catalogue?.topTracks ?? [];
  if (topTracks.length > 0) {
    const hub = addHub("tracks");
    topTracks.slice(0, CAPS.tracks).forEach((track) => {
      const id = `track:${track.id}`;
      if (push({
        id,
        kind: "track",
        label: track.title,
        category: "tracks",
        track,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const platforms = context.links?.platforms ?? [];
  if (platforms.length > 0) {
    const hub = addHub("links");
    platforms.slice(0, CAPS.links).forEach((platform, i) => {
      const id = `link:${i}:${platform.name}`;
      if (push({
        id,
        kind: "link",
        label: platform.name,
        category: "links",
        platform,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const merch = verifiedMerchForContext(context);
  if (merch.length > 0) {
    const hub = addHub("support");
    merch.forEach((product) => {
      const destinationKey = product.destinationUrl.replace(/\/+$/, "");
      const id = `merch:${destinationKey}`;
      if (
        push({
          id,
          kind: "merch",
          label: product.title,
          sublabel: product.source,
          category: "support",
          merch: product,
        })
      ) {
        links.push({ source: hub, target: id });
      }
    });
  }

  const insights = context.insights ?? [];
  if (insights.length > 0) {
    const hub = addHub("insights");
    insights.slice(0, CAPS.insights).forEach((insight, i) => {
      const id = `insight:${i}:${insight.positionMs}`;
      if (push({
        id,
        kind: "insight",
        label: formatPosition(insight.positionMs),
        sublabel: insight.text,
        category: "insights",
        insight,
      })) {
        links.push({ source: hub, target: id });
      }
    });
  }

  return { nodes, links };
}
