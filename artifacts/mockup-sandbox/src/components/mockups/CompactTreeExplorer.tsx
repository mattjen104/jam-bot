import { useState, type CSSProperties, type ReactNode } from "react";

type TreeNodeProps = {
  kind: "category" | "station" | "album";
  label: string;
  detail?: string;
  children?: ReactNode;
  defaultOpen?: boolean;
  defaultSelected?: boolean;
  nowPlaying?: string;
  stats?: string;
  pie?: number;
  empty?: boolean;
};

function Pie({ value }: { value: number }) {
  return (
    <span
      className="tree-pie"
      style={{ "--pie": `${value}%` } as CSSProperties}
      aria-label={`${value}% recent`}
      title={`${value}% recent`}
    />
  );
}

function TreeNode({
  kind,
  label,
  detail,
  children,
  defaultOpen = false,
  defaultSelected = true,
  nowPlaying,
  stats,
  pie,
  empty = false,
}: TreeNodeProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [selected, setSelected] = useState(defaultSelected);
  const hasChildren = Boolean(children);

  return (
    <div className={`tree-node tree-node--${kind} ${selected ? "" : "tree-node--off"}`}>
      <div className="tree-node__line">
        {hasChildren ? (
          <button
            className="tree-disclosure"
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="tree-disclosure tree-disclosure--leaf" aria-hidden="true">·</span>
        )}
        <button
          className="tree-check"
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={`${selected ? "Deselect" : "Select"} ${label}`}
          onClick={() => setSelected((value) => !value)}
        >
          {selected ? "■" : "□"}
        </button>
        <button
          className="tree-label"
          type="button"
          onClick={() => hasChildren && setOpen((value) => !value)}
          aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
        >
          <span className="tree-label__main">{label}</span>
          {detail && <span className="tree-label__detail">{detail}</span>}
        </button>
        {kind !== "album" && (
          <span className="tree-context">
            {nowPlaying && <span className="tree-now">{nowPlaying}</span>}
            {stats && <span>{stats}</span>}
            {pie !== undefined && <Pie value={pie} />}
          </span>
        )}
      </div>
      {open && (
        <div className="tree-node__children">
          {nowPlaying && (
            <div className="tree-header">
              <span className="tree-header__track">{nowPlaying}</span>
              <span className="tree-header__meta">{stats ?? "No listener activity yet"}</span>
              {pie !== undefined && <Pie value={pie} />}
            </div>
          )}
          {empty ? (
            <div className="tree-empty">No stations on air in this branch</div>
          ) : children}
        </div>
      )}
    </div>
  );
}

function DialTree() {
  return (
    <div className="tree-surface">
      <div className="tree-kicker">CompactDial / category → station</div>
      <div className="tree-title-row">
        <h2>Listening now</h2>
        <span className="tree-hint">select · reveal</span>
      </div>
      <div className="tree-root">
        <TreeNode
          kind="category"
          label="Electronic"
          detail="4 stations"
          defaultOpen
          nowPlaying="Four Tet — Two Thousand and Seventeen"
          stats="3 crossings · 1 first play"
          pie={72}
        >
          <TreeNode
            kind="station"
            label="NTS Radio"
            detail="London · live"
            defaultOpen
            nowPlaying="Four Tet — Two Thousand and Seventeen"
            stats="2 crossings · 1 first play"
            pie={84}
          >
            <div className="tree-station-note">on air now · 42m ago in your log</div>
          </TreeNode>
          <TreeNode kind="station" label="KEXP — Seattle" detail="quiet signal" defaultSelected={false} />
          <TreeNode kind="station" label="The Lot Radio" detail="live · 1 crossing" />
        </TreeNode>
        <TreeNode
          kind="category"
          label="Jazz & adjacent"
          detail="2 stations"
          nowPlaying="No current track"
          stats="0 crossings · 0 first plays"
          pie={18}
          defaultSelected={false}
          empty
        />
        <TreeNode kind="category" label="Other stations" detail="empty" defaultSelected={false} />
      </div>
      <div className="tree-legend">
        <span><i className="legend-mark legend-mark--on">■</i> in scan</span>
        <span><i className="legend-mark">□</i> deselected, still reachable</span>
        <span><i className="legend-line" /> disclosure is separate</span>
      </div>
    </div>
  );
}

function StackTree() {
  return (
    <div className="tree-surface">
      <div className="tree-kicker">CompactStack / group → album → notes</div>
      <div className="tree-title-row">
        <h2>Kept albums</h2>
        <span className="tree-hint">5 groups · newest first</span>
      </div>
      <div className="tree-root">
        <TreeNode kind="category" label="Fleetwood Mac" detail="3 albums" defaultOpen>
          <TreeNode
            kind="album"
            label="Rumours"
            detail="1977 · 11 tracks"
            defaultOpen
          >
            <div className="tree-album-notes">
              <span>cover · Buckingham / Nicks</span>
              <span>pressing · Warner Bros. 1977</span>
              <span className="tree-note-link">→ investigate liner notes</span>
            </div>
          </TreeNode>
          <TreeNode kind="album" label="Tusk" detail="1979 · 20 tracks" defaultSelected={false} />
          <TreeNode kind="album" label="Mirage" detail="1982 · 12 tracks" />
        </TreeNode>
        <TreeNode kind="category" label="Radiohead" detail="2 albums" defaultSelected={false}>
          <TreeNode kind="album" label="In Rainbows" detail="2007 · 10 tracks" />
        </TreeNode>
        <TreeNode kind="category" label="Unresolved" detail="no album metadata" defaultSelected={false} empty />
      </div>
      <div className="tree-legend">
        <span><i className="legend-mark legend-mark--on">■</i> kept</span>
        <span><i className="legend-mark">□</i> hidden from window</span>
        <span>album notes stay in the branch</span>
      </div>
    </div>
  );
}

function MobileSpecimen() {
  return (
    <div className="tree-phone">
      <div className="tree-phone__top"><span>narrow / 360px</span><span>same grammar</span></div>
      <DialTree />
    </div>
  );
}

export function CompactTreeExplorer() {
  return (
    <main className="tree-explorer">
      <header className="tree-explorer__header">
        <div>
          <p className="tree-kicker">Lore · interaction study 04</p>
          <h1>Compact surfaces, without the card stack</h1>
          <p className="tree-explorer__lede">
            A calmer tree for scanning what is live and what you kept. Disclosure and selection stay independent.
          </p>
        </div>
        <div className="tree-explorer__status"><span className="status-dot" /> listening context stays inline</div>
      </header>
      <section className="tree-grid" aria-label="Compact tree variants">
        <DialTree />
        <StackTree />
      </section>
      <section className="tree-mobile-section">
        <div>
          <p className="tree-kicker">Responsive check</p>
          <h2>One column at phone width</h2>
          <p className="tree-copy">The same states wrap their context instead of introducing a horizontal rail.</p>
        </div>
        <MobileSpecimen />
      </section>
    </main>
  );
}

export default CompactTreeExplorer;