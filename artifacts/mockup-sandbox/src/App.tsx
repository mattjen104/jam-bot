import { useEffect, useState, type ComponentType } from "react";

import { modules as discoveredModules } from "./.generated/mockup-components";

type ModuleMap = Record<string, () => Promise<Record<string, unknown>>>;

function _resolveComponent(
  mod: Record<string, unknown>,
  name: string,
): ComponentType | undefined {
  const fns = Object.values(mod).filter(
    (v) => typeof v === "function",
  ) as ComponentType[];
  return (
    (mod.default as ComponentType) ||
    (mod.Preview as ComponentType) ||
    (mod[name] as ComponentType) ||
    fns[fns.length - 1]
  );
}

function PreviewRenderer({
  componentPath,
  modules,
}: {
  componentPath: string;
  modules: ModuleMap;
}) {
  const [Component, setComponent] = useState<ComponentType | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setComponent(null);
    setError(null);

    async function loadComponent(): Promise<void> {
      const key = `./components/mockups/${componentPath}.tsx`;
      const loader = modules[key];
      if (!loader) {
        setError(`No component found at ${componentPath}.tsx`);
        return;
      }

      try {
        const mod = await loader();
        if (cancelled) {
          return;
        }
        const name = componentPath.split("/").pop()!;
        const comp = _resolveComponent(mod, name);
        if (!comp) {
          setError(
            `No exported React component found in ${componentPath}.tsx\n\nMake sure the file has at least one exported function component.`,
          );
          return;
        }
        setComponent(() => comp);
      } catch (e) {
        if (cancelled) {
          return;
        }

        const message = e instanceof Error ? e.message : String(e);
        setError(`Failed to load preview.\n${message}`);
      }
    }

    void loadComponent();

    return () => {
      cancelled = true;
    };
  }, [componentPath, modules]);

  if (error) {
    return (
      <pre style={{ color: "red", padding: "2rem", fontFamily: "system-ui" }}>
        {error}
      </pre>
    );
  }

  if (!Component) return null;

  return <Component />;
}

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getPreviewExamplePath(): string {
  const basePath = getBasePath();
  return `${basePath}/preview/ComponentName`;
}

const MOCKUPS = [
  {
    path: "CompactTreeExplorer",
    tag: "Interaction study · ultra-minimal",
    title: "CompactDial + CompactStack Tree",
    desc: "A live tree exploration with independent disclosure/selection, inline now-playing context, and a narrow-width specimen.",
    tagColor: "#b9d99b",
    tagBorder: "rgba(185,217,155,0.35)",
    border: "#4a5743",
    hoverBorder: "#b9d99b",
    bg: "#1b211d",
  },
  {
    path: "lore-unified-arch/UnifiedArch",
    tag: "Annotated architecture · warm-dark",
    title: "Lore Unified Minimal Interface",
    desc: "Feed, Stack, row grammar, coverage marker, and Album Investigation sheet. Warm dark palette.",
    tagColor: "#9b8cf5",
    tagBorder: "rgba(155,140,245,0.35)",
    border: "#504d42",
    hoverBorder: "#9b8cf5",
    bg: "#211f1c",
  },
  {
    path: "lore-on-air-record-piles/LoreOnAirRecordPiles",
    tag: "Interaction study · on air",
    title: "On-Air Record Piles",
    desc: "Clickable, capped album-cover piles replace station logos while crossing scope controls move every live station together.",
    tagColor: "#e5a650",
    tagBorder: "rgba(229,166,80,0.35)",
    border: "#514334",
    hoverBorder: "#e5a650",
    bg: "#211b15",
  },
  {
    path: "lore-grayscale/LoreGrayscale",
    tag: "Annotated architecture · grayscale",
    title: "Lore Grayscale — Terminal Variant",
    desc: "Same structure. True black / lavender-gray / bright white. ASCII borders, monospace throughout.",
    tagColor: "#b8b8cc",
    tagBorder: "rgba(184,184,204,0.3)",
    border: "#2a2a30",
    hoverBorder: "#b8b8cc",
    bg: "#0a0a0b",
  },
] as const;

function Gallery() {
  const basePath = getBasePath();

  return (
    <div style={{ minHeight: "100vh", background: "#111113", display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
      <div style={{ textAlign: "left", maxWidth: 680, width: "100%" }}>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#888899", marginBottom: 12 }}>
          Lore design workspace
        </p>
        <h1 style={{ fontFamily: "ui-monospace, monospace", fontSize: 22, fontWeight: 700, color: "#ffffff", marginBottom: 8 }}>
          Component Preview Server
        </h1>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#b8b8cc", marginBottom: 28 }}>
          Open an isolated preview below. Design references — not production Lore routes.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {MOCKUPS.map((m) => (
            <a
              key={m.path}
              href={`${basePath}/preview/${m.path}`}
              style={{
                display: "block",
                border: `1px solid ${m.border}`,
                background: m.bg,
                padding: "16px 18px",
                textDecoration: "none",
                color: "#ffffff",
                transition: "border-color 0.12s",
                fontFamily: "ui-monospace, monospace",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = m.hoverBorder; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = m.border; }}
            >
              <span style={{ display: "inline-block", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: m.tagColor, border: `1px solid ${m.tagBorder}`, padding: "1px 6px", marginBottom: 8 }}>
                {m.tag}
              </span>
              <span style={{ display: "block", fontSize: 15, fontWeight: 700, marginBottom: 4 }}>
                {m.title}
              </span>
              <span style={{ display: "block", fontSize: 12, color: "#888899", lineHeight: 1.5 }}>
                {m.desc}
              </span>
            </a>
          ))}
        </div>
        <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "#3d3d47", marginTop: 24 }}>
          More previews at{" "}
          <code style={{ color: "#888899" }}>{getPreviewExamplePath()}</code>
        </p>
      </div>
    </div>
  );
}

function getPreviewPath(): string | null {
  const basePath = getBasePath();
  const { pathname } = window.location;
  const local =
    basePath && pathname.startsWith(basePath)
      ? pathname.slice(basePath.length) || "/"
      : pathname;
  const match = local.match(/^\/preview\/(.+)$/);
  return match ? match[1] : null;
}

function App() {
  const previewPath = getPreviewPath();

  if (previewPath) {
    return (
      <PreviewRenderer
        componentPath={previewPath}
        modules={discoveredModules}
      />
    );
  }

  return <Gallery />;
}

export default App;
