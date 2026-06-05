import { ExternalLink, Mail, Clock, Disc3, Tag, Users, Music2, Link2, AlertTriangle } from "lucide-react";
import type { SongContext } from "@workspace/api-client-react";
import type { GraphNode } from "@/lib/graph";
import { ANCHOR_ID, formatPosition } from "@/lib/graph";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

interface DossierProps {
  context: SongContext;
  selectedNode: GraphNode | null;
  onClearSelection: () => void;
}

function trackUrl(id: string) {
  return `https://open.spotify.com/track/${id}`;
}

function sampleMailto(context: SongContext, line?: string) {
  const artists = context.track.artists.join(", ");
  const subject = `Sample clearance request: "${context.track.name}" by ${artists}`;
  const bodyLines = [
    "Hello,",
    "",
    `I'm a producer interested in clearing a sample from "${context.track.name}" by ${artists}.`,
    line ? line : "",
    context.knowledge?.recordingId
      ? `MusicBrainz recording: ${context.knowledge.recordingId}`
      : "",
    `Reference: ${context.track.spotifyUrl}`,
    "",
    "Could you point me to the rights holder or publishing contact?",
    "",
    "Thank you,",
  ].filter(Boolean);
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\r\n"))}`;
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Tag; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      <span>{children}</span>
    </div>
  );
}

function ApproxBadge({ approximate }: { approximate: boolean }) {
  if (!approximate) return null;
  return (
    <Badge
      variant="outline"
      className="gap-1 border-amber-700/40 text-amber-400"
      data-testid="badge-approximate"
    >
      <AlertTriangle className="h-3 w-3" />
      Reconstructed
    </Badge>
  );
}

function AnchorDossier({ context }: { context: SongContext }) {
  const { track, knowledge, context: ctx } = context;
  const summary = knowledge?.summary ?? ctx?.summary ?? null;
  return (
    <div className="space-y-6" data-testid="dossier-anchor">
      <div className="space-y-2">
        <p className="text-[0.7rem] uppercase tracking-[0.22em] text-primary/80">
          Case file
        </p>
        <h2 className="font-mono text-2xl leading-tight" data-testid="text-track-name">
          {track.name}
        </h2>
        <p className="text-sm text-muted-foreground" data-testid="text-track-artists">
          {track.artists.join(" · ")}
        </p>
        {track.album && (
          <p className="text-xs text-muted-foreground/80">{track.album}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {knowledge?.approximate && <ApproxBadge approximate />}
          <a href={track.spotifyUrl} target="_blank" rel="noreferrer">
            <Badge variant="secondary" className="gap-1" data-testid="link-spotify">
              Spotify <ExternalLink className="h-3 w-3" />
            </Badge>
          </a>
          {ctx?.wikipediaUrl && (
            <a href={ctx.wikipediaUrl} target="_blank" rel="noreferrer">
              <Badge variant="secondary" className="gap-1" data-testid="link-wikipedia">
                Wikipedia <ExternalLink className="h-3 w-3" />
              </Badge>
            </a>
          )}
          {ctx?.geniusUrl && (
            <a href={ctx.geniusUrl} target="_blank" rel="noreferrer">
              <Badge variant="secondary" className="gap-1" data-testid="link-genius">
                Genius <ExternalLink className="h-3 w-3" />
              </Badge>
            </a>
          )}
        </div>
      </div>

      {summary && (
        <p className="text-sm leading-relaxed text-foreground/90" data-testid="text-summary">
          {summary}
        </p>
      )}

      {knowledge?.pressing &&
        (knowledge.pressing.label ||
          knowledge.pressing.year ||
          knowledge.pressing.country ||
          knowledge.pressing.format) && (
          <div className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
            <SectionLabel icon={Disc3}>Pressing</SectionLabel>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {knowledge.pressing.label && (
                <>
                  <dt className="text-muted-foreground">Label</dt>
                  <dd>{knowledge.pressing.label}</dd>
                </>
              )}
              {knowledge.pressing.year != null && (
                <>
                  <dt className="text-muted-foreground">Year</dt>
                  <dd>{knowledge.pressing.year}</dd>
                </>
              )}
              {knowledge.pressing.country && (
                <>
                  <dt className="text-muted-foreground">Country</dt>
                  <dd>{knowledge.pressing.country}</dd>
                </>
              )}
              {knowledge.pressing.format && (
                <>
                  <dt className="text-muted-foreground">Format</dt>
                  <dd>{knowledge.pressing.format}</dd>
                </>
              )}
            </dl>
          </div>
        )}

      {ctx?.bio && (
        <div className="space-y-2">
          <SectionLabel icon={Users}>Artist</SectionLabel>
          <p className="text-sm leading-relaxed text-foreground/80">{ctx.bio}</p>
        </div>
      )}

      <Separator />
      <a href={sampleMailto(context)} data-testid="link-request-sample-track">
        <Button className="w-full gap-2">
          <Mail className="h-4 w-4" />
          Request to sample
        </Button>
      </a>
    </div>
  );
}

function NodeDossier({
  context,
  node,
}: {
  context: SongContext;
  node: GraphNode;
}) {
  switch (node.kind) {
    case "hub":
      return (
        <div className="space-y-2" data-testid="dossier-hub">
          <SectionLabel icon={Tag}>Cluster</SectionLabel>
          <h3 className="font-mono text-xl">{node.label}</h3>
          <p className="text-sm text-muted-foreground">
            Select an individual node in this cluster to inspect its provenance.
          </p>
        </div>
      );
    case "credit": {
      const credit = node.credit!;
      return (
        <div className="space-y-5" data-testid="dossier-credit">
          <div className="space-y-1">
            <SectionLabel icon={Users}>Personnel</SectionLabel>
            <h3 className="font-mono text-xl">{credit.name}</h3>
            <p className="text-sm text-primary/90">{credit.role}</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Credited on "{context.track.name}". Sample clearance for a specific
            performance often routes through the performer's estate or union.
          </p>
          <a
            href={sampleMailto(
              context,
              `Specifically, I'd like to clear the ${credit.role} performance by ${credit.name}.`,
            )}
            data-testid="link-request-sample-credit"
          >
            <Button className="w-full gap-2">
              <Mail className="h-4 w-4" />
              Request to sample this part
            </Button>
          </a>
        </div>
      );
    }
    case "genre":
      return (
        <div className="space-y-2" data-testid="dossier-genre">
          <SectionLabel icon={Tag}>Genre / Tag</SectionLabel>
          <h3 className="font-mono text-xl">{node.label}</h3>
          <p className="text-sm text-muted-foreground">
            A descriptor associated with {context.context?.artistName ?? "this artist"}.
          </p>
        </div>
      );
    case "similar":
      return (
        <div className="space-y-3" data-testid="dossier-similar">
          <SectionLabel icon={Users}>Similar Artist</SectionLabel>
          <h3 className="font-mono text-xl">{node.label}</h3>
          <p className="text-sm text-muted-foreground">
            Sits in the same lineage as {context.context?.artistName ?? "this artist"}.
          </p>
          <a
            href={`https://open.spotify.com/search/${encodeURIComponent(node.label)}`}
            target="_blank"
            rel="noreferrer"
            data-testid="link-similar-spotify"
          >
            <Button variant="secondary" className="w-full gap-2">
              Find on Spotify <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
        </div>
      );
    case "album": {
      const album = node.album!;
      return (
        <div className="space-y-3" data-testid="dossier-album">
          <SectionLabel icon={Disc3}>Album</SectionLabel>
          <h3 className="font-mono text-xl">{album.name}</h3>
          {album.year != null && (
            <p className="text-sm text-muted-foreground">{album.year}</p>
          )}
          <a href={album.url} target="_blank" rel="noreferrer" data-testid="link-album">
            <Button variant="secondary" className="w-full gap-2">
              Open album <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
        </div>
      );
    }
    case "track": {
      const track = node.track!;
      return (
        <div className="space-y-3" data-testid="dossier-track">
          <SectionLabel icon={Music2}>Top Track</SectionLabel>
          <h3 className="font-mono text-xl">{track.title}</h3>
          <a
            href={trackUrl(track.id)}
            target="_blank"
            rel="noreferrer"
            data-testid="link-catalogue-track"
          >
            <Button variant="secondary" className="w-full gap-2">
              Open on Spotify <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
        </div>
      );
    }
    case "link": {
      const platform = node.platform!;
      return (
        <div className="space-y-3" data-testid="dossier-link">
          <SectionLabel icon={Link2}>Listen Elsewhere</SectionLabel>
          <h3 className="font-mono text-xl">{platform.name}</h3>
          <a href={platform.url} target="_blank" rel="noreferrer" data-testid="link-platform">
            <Button variant="secondary" className="w-full gap-2">
              Open {platform.name} <ExternalLink className="h-4 w-4" />
            </Button>
          </a>
        </div>
      );
    }
    case "insight": {
      const insight = node.insight!;
      return (
        <div className="space-y-3" data-testid="dossier-insight">
          <SectionLabel icon={Clock}>Timed Note</SectionLabel>
          <h3 className="font-mono text-xl">{formatPosition(insight.positionMs)}</h3>
          <p className="text-sm leading-relaxed text-foreground/90">{insight.text}</p>
        </div>
      );
    }
    default:
      return null;
  }
}

export function Dossier({ context, selectedNode, onClearSelection }: DossierProps) {
  const showAnchor = !selectedNode || selectedNode.id === ANCHOR_ID;
  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-5">
        {!showAnchor && selectedNode && (
          <button
            type="button"
            onClick={onClearSelection}
            className="text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
            data-testid="button-back-to-case"
          >
            ← Back to case file
          </button>
        )}
        {showAnchor ? (
          <AnchorDossier context={context} />
        ) : (
          <NodeDossier context={context} node={selectedNode!} />
        )}
      </div>
    </ScrollArea>
  );
}
