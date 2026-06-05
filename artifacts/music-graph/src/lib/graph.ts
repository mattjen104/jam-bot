import type {
  SongContext,
  Credit,
  CatalogueAlbum,
  CatalogueTrack,
  TrackLink,
  TrackInsight,
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
  | "insight";

export type HubCategory =
  | "personnel"
  | "genres"
  | "similar"
  | "albums"
  | "tracks"
  | "links"
  | "insights";

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
  genres: "Genres & Tags",
  similar: "Similar Artists",
  albums: "Albums",
  tracks: "Top Tracks",
  links: "Listen Elsewhere",
  insights: "Timed Notes",
};

const CAPS: Record<HubCategory, number> = {
  personnel: 16,
  genres: 14,
  similar: 12,
  albums: 12,
  tracks: 10,
  links: 12,
  insights: 24,
};

export const ANCHOR_ID = "anchor";

export function formatPosition(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
