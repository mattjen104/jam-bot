import { useEffect, useMemo, useRef } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
} from "d3-force";
import type { GraphData, GraphNode, NodeKind } from "@/lib/graph";
import { ANCHOR_ID } from "@/lib/graph";
import { cn } from "@/lib/utils";

interface SimNode extends GraphNode {
  index?: number;
}

interface SimLink {
  source: SimNode;
  target: SimNode;
}

interface ForceGraphProps {
  data: GraphData;
  selectedId: string | null;
  onSelect: (id: string) => void;
  anchorPlayer: React.ReactNode;
}

const RADIUS: Record<NodeKind, number> = {
  anchor: 150,
  hub: 46,
  credit: 38,
  genre: 30,
  similar: 36,
  album: 40,
  track: 36,
  link: 30,
  insight: 34,
  connection: 36,
};

const kindClass: Record<NodeKind, string> = {
  anchor: "",
  hub: "node-hub",
  credit: "node-credit",
  genre: "node-genre",
  similar: "node-similar",
  album: "node-album",
  track: "node-track",
  link: "node-link",
  insight: "node-insight",
  connection: "node-connection",
};

export function ForceGraph({
  data,
  selectedId,
  onSelect,
  anchorPlayer,
}: ForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef<Map<string, HTMLElement>>(new Map());
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const view = useRef({ x: 0, y: 0, k: 1 });

  // Stable simulation node objects keyed by id, rebuilt only when graph changes.
  const graphKey = useMemo(
    () => data.nodes.map((n) => n.id).join("|"),
    [data.nodes],
  );

  const sim = useMemo(() => {
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.links
      .map((l) => {
        const source = byId.get(l.source);
        const target = byId.get(l.target);
        if (!source || !target) return null;
        return { source, target };
      })
      .filter((l): l is SimLink => l !== null);
    return { nodes, links, byId };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  const applyView = () => {
    const scene = sceneRef.current;
    if (!scene) return;
    const { x, y, k } = view.current;
    scene.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  };

  // Build & run the simulation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 600;

    // Seed positions radially so the first frames look intentional.
    sim.nodes.forEach((n, i) => {
      if (n.id === ANCHOR_ID) {
        n.x = 0;
        n.y = 0;
      } else if (n.x == null) {
        const angle = (i / Math.max(1, sim.nodes.length)) * Math.PI * 2;
        const r = n.kind === "hub" ? 220 : 360;
        n.x = Math.cos(angle) * r;
        n.y = Math.sin(angle) * r;
      }
    });

    // Center the scene on the container.
    view.current = { x: width / 2, y: height / 2, k: 1 };
    applyView();

    const simulation = forceSimulation<SimNode, SimLink>(sim.nodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(sim.links)
          .id((d) => d.id)
          .distance((l) => {
            if (l.source.id === ANCHOR_ID || l.target.id === ANCHOR_ID)
              return 230;
            return 96;
          })
          .strength(0.5),
      )
      .force(
        "charge",
        forceManyBody<SimNode>().strength((d) =>
          d.kind === "anchor" ? -1400 : d.kind === "hub" ? -700 : -260,
        ),
      )
      .force("center", forceCenter(0, 0).strength(0.04))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => RADIUS[d.kind] + 14),
      )
      .velocityDecay(0.32);

    // Pin the anchor at the origin.
    const anchor = sim.byId.get(ANCHOR_ID);
    if (anchor) {
      anchor.fx = 0;
      anchor.fy = 0;
    }

    const tick = () => {
      for (const n of sim.nodes) {
        const el = nodeEls.current.get(n.id);
        if (el && n.x != null && n.y != null) {
          el.style.transform = `translate(calc(${n.x}px - 50%), calc(${n.y}px - 50%))`;
        }
      }
      sim.links.forEach((l, i) => {
        const line = lineEls.current[i];
        if (line && l.source.x != null && l.target.x != null) {
          line.setAttribute("x1", String(l.source.x));
          line.setAttribute("y1", String(l.source.y));
          line.setAttribute("x2", String(l.target.x));
          line.setAttribute("y2", String(l.target.y));
        }
      });
    };

    simulation.on("tick", tick);
    simRef.current = simulation;

    return () => {
      simulation.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim]);

  // Pan & zoom on the container background.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let panning = false;
    let startX = 0;
    let startY = 0;
    let startVX = 0;
    let startVY = 0;

    const onPointerDown = (e: PointerEvent) => {
      // Only pan when the gesture starts on the background, not a node.
      if ((e.target as HTMLElement).closest("[data-node]")) return;
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startVX = view.current.x;
      startVY = view.current.y;
      container.setPointerCapture(e.pointerId);
      container.style.cursor = "grabbing";
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      view.current.x = startVX + (e.clientX - startX);
      view.current.y = startVY + (e.clientY - startY);
      applyView();
    };
    const onPointerUp = (e: PointerEvent) => {
      panning = false;
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      container.style.cursor = "grab";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { x, y, k } = view.current;
      const worldX = (px - x) / k;
      const worldY = (py - y) / k;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newK = Math.min(2.4, Math.max(0.3, k * factor));
      view.current.k = newK;
      view.current.x = px - worldX * newK;
      view.current.y = py - worldY * newK;
      applyView();
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("wheel", onWheel);
    };
  }, []);

  const handleNodePointerDown = (e: React.PointerEvent, node: SimNode) => {
    if (node.id === ANCHOR_ID) return; // anchor stays pinned
    e.stopPropagation();
    const simulation = simRef.current;
    if (!simulation) return;
    const target = sim.byId.get(node.id);
    if (!target) return;

    let moved = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const k = view.current.k;
    const originX = target.x ?? 0;
    const originY = target.y ?? 0;

    simulation.alphaTarget(0.3).restart();
    target.fx = originX;
    target.fy = originY;

    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / k;
      const dy = (ev.clientY - startY) / k;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      target.fx = originX + dx;
      target.fy = originY + dy;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      simulation.alphaTarget(0);
      target.fx = null;
      target.fy = null;
      if (!moved) onSelect(node.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden touch-none"
      style={{ cursor: "grab" }}
      data-testid="graph-canvas"
    >
      <div
        ref={sceneRef}
        className="absolute left-0 top-0"
        style={{ transformOrigin: "0 0" }}
      >
        <svg
          ref={svgRef}
          className="absolute left-0 top-0 overflow-visible"
          width={1}
          height={1}
          style={{ pointerEvents: "none" }}
        >
          {sim.links.map((l, i) => (
            <line
              key={`${l.source.id}->${l.target.id}`}
              ref={(el) => {
                lineEls.current[i] = el;
              }}
              className={cn(
                "graph-edge",
                (l.source.id === selectedId || l.target.id === selectedId) &&
                  "graph-edge-active",
              )}
            />
          ))}
        </svg>

        {sim.nodes.map((node) => {
          const isSelected = node.id === selectedId;
          if (node.kind === "anchor") {
            return (
              <div
                key={node.id}
                data-node
                data-testid="node-anchor"
                ref={(el) => {
                  if (el) nodeEls.current.set(node.id, el);
                  else nodeEls.current.delete(node.id);
                }}
                className={cn(
                  "absolute left-0 top-0 anchor-node rounded-xl",
                  isSelected && "anchor-node-selected",
                )}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSelect(node.id);
                }}
              >
                {anchorPlayer}
              </div>
            );
          }
          return (
            <button
              key={node.id}
              type="button"
              data-node
              data-testid={`node-${node.id}`}
              ref={(el) => {
                if (el) nodeEls.current.set(node.id, el);
                else nodeEls.current.delete(node.id);
              }}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              className={cn(
                "absolute left-0 top-0 graph-node",
                kindClass[node.kind],
                isSelected && "graph-node-selected",
              )}
              style={{ maxWidth: RADIUS[node.kind] * 3 }}
            >
              <span className="graph-node-label">{node.label}</span>
              {node.sublabel && node.kind !== "insight" && (
                <span className="graph-node-sublabel">{node.sublabel}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
