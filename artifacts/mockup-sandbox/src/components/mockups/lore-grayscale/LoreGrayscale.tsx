/**
 * Lore Grayscale — Minimal Terminal Variant
 *
 * Palette: true black / slightly-lavender lore-gray / bright white.
 * ASCII borders, monospace throughout, no warm tones, no color accents.
 * Structural anatomy identical to UnifiedArch so diffs are intentional.
 */
import "./_grayscale.css";

/* ─── primitives ──────────────────────────────────────────────────── */

function Dot() {
  return <span className="gs-dot"> · </span>;
}

function Rule({ label }: { label?: string }) {
  if (label) {
    return (
      <div className="gs-rule-label">
        <span className="gs-rule-text">── {label}</span>
      </div>
    );
  }
  return <div className="gs-rule" />;
}

function Note({ text }: { text: string }) {
  return <span className="gs-note">{text}</span>;
}

function CoverageMark() {
  return (
    <sup
      className="gs-coverage"
      title="Investigation sources indexed"
      aria-label="Investigation sources indexed"
    >
      *
    </sup>
  );
}

function LiveBadge({ elapsed }: { elapsed?: string }) {
  return (
    <span className="gs-live-badge">
      {elapsed ? `● ${elapsed}` : "● live"}
    </span>
  );
}

function GhostBadge({ ago }: { ago: string }) {
  return <span className="gs-ghost-badge">{ago}</span>;
}

/* ─── Feed row ────────────────────────────────────────────────────── */

interface FeedRowProps {
  artist: string;
  station: string;
  expanded?: boolean;
  showDJ?: string;
  nowPlaying?: string;
  ghost?: boolean;
  hasCoverage?: boolean;
  elapsed?: string;
  ago?: string;
}

function FeedRow({
  artist,
  station,
  expanded,
  showDJ,
  nowPlaying,
  ghost,
  hasCoverage,
  elapsed,
  ago,
}: FeedRowProps) {
  return (
    <div className={`gs-row${ghost ? " gs-row--ghost" : ""}${expanded ? " gs-row--expanded" : ""}`}>
      <div className="gs-row-head">
        <span className="gs-primary">
          {artist}
          {hasCoverage && <CoverageMark />}
        </span>
        <Dot />
        <span className="gs-secondary">{station}</span>
        <span className="gs-meta">
          {ghost ? (
            <GhostBadge ago={ago ?? ""} />
          ) : (
            <LiveBadge elapsed={elapsed} />
          )}
        </span>
      </div>
      {expanded && (
        <div className="gs-byline">
          <span className="gs-byline-text">
            {showDJ}
            {showDJ && nowPlaying && <Dot />}
            {nowPlaying}
          </span>
          {ghost ? (
            <span className="gs-action gs-action--ghost">→ replay</span>
          ) : (
            <span className="gs-action">+ Keep</span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Stack row ───────────────────────────────────────────────────── */

interface StackRowProps {
  album: string;
  artist: string;
  keptCount: number;
  provenance: string;
  expanded?: boolean;
  hasCoverage?: boolean;
  tracks?: { title: string; via: string; date: string }[];
}

function StackRow({
  album,
  artist,
  keptCount,
  provenance,
  expanded,
  hasCoverage,
  tracks,
}: StackRowProps) {
  return (
    <div className={`gs-stack-row${expanded ? " gs-stack-row--expanded" : ""}`}>
      <div className="gs-row-head">
        <span className="gs-primary">
          {album}
          {hasCoverage && <CoverageMark />}
        </span>
        <Dot />
        <span className="gs-secondary">{artist}</span>
        <span className="gs-meta gs-kept">{keptCount} kept</span>
      </div>
      <div className="gs-byline">
        <span className="gs-byline-text">{provenance}</span>
        {expanded && <span className="gs-action gs-action--launch">▶ launch</span>}
      </div>
      {expanded && tracks && (
        <div className="gs-subrows">
          {tracks.map((t, i) => (
            <div key={i} className="gs-subrow">
              <span className="gs-subrow-primary">{t.title}</span>
              <Dot />
              <span className="gs-subrow-sec">{t.via}</span>
              <span className="gs-subrow-date">{t.date}</span>
            </div>
          ))}
          <div className="gs-investigate-row">↗ investigate · sources indexed</div>
        </div>
      )}
    </div>
  );
}

/* ─── Source card (Album Investigation sheet) ─────────────────────── */

interface SourceCardProps {
  label: string;
  type: string;
  date: string;
  excerpt: string;
  notIndexed?: boolean;
}

function SourceCard({ label, type, date, excerpt, notIndexed }: SourceCardProps) {
  return (
    <div className={`gs-source${notIndexed ? " gs-source--pending" : ""}`}>
      <div className="gs-source-head">
        <span className="gs-source-label">{label}</span>
        <span className="gs-source-type"> · {type}</span>
        <span className="gs-source-date">{date}</span>
      </div>
      <p className="gs-source-excerpt">{excerpt}</p>
      {!notIndexed && <span className="gs-source-open">↗ open</span>}
    </div>
  );
}

/* ─── ASCII box ───────────────────────────────────────────────────── */

function AsciiBox({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="gs-ascii-box">
      {label && <div className="gs-ascii-box-label">{label}</div>}
      {children}
    </div>
  );
}

/* ─── Main mockup ─────────────────────────────────────────────────── */

export function LoreGrayscale() {
  return (
    <div className="lore-gs">
      <div className="gs-wrap">

        {/* ── header ─────────────────────────────────────────────── */}
        <div className="gs-header">
          <div className="gs-eyebrow">LORE — GRAYSCALE VARIANT</div>
          <h1 className="gs-title">Architecture Mockup</h1>
          <p className="gs-subtitle">
            Minimal terminal treatment. Black / lavender-gray / white.
            Same structure as <code>INTERFACE_ARCHITECTURE.md</code>.
          </p>
        </div>

        {/* ── § 1  three-phase loop ──────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 1 · THE THREE-PHASE LOOP" />
          <AsciiBox>
            {[
              { n: "01", label: "SCAN  ", nav: "Feed",  desc: "Seeded artists on air anywhere on the network" },
              { n: "02", label: "KEEP  ", nav: "Dock",  desc: "Tap Keep. Provenance captured. No navigation." },
              { n: "03", label: "STACK ", nav: "Stack", desc: "Albums to investigate. Launch when ready." },
            ].map((p, i) => (
              <div key={i} className="gs-phase-row">
                <span className="gs-phase-n">{p.n}</span>
                <span className="gs-phase-label">{p.label}</span>
                <span className="gs-phase-nav">[{p.nav}]</span>
                <span className="gs-phase-desc">{p.desc}</span>
                {i < 2 && <span className="gs-phase-arrow"> ↓</span>}
              </div>
            ))}
          </AsciiBox>
        </section>

        {/* ── § 2  nav ───────────────────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 2 · NAVIGATION (PORTRAIT / BOTTOM NAV)" />
          <div className="gs-note-line">
            <Note text="── Two labels only. No tabs. Player dock always visible above nav." />
          </div>
          <AsciiBox label="PLAYER DOCK">
            <div className="gs-dock">
              <span className="gs-dock-thumb">▌</span>
              <div className="gs-dock-track">
                <span className="gs-dock-title">Sleep · Dopesmoker</span>
                <span className="gs-dock-station">● KFAI 90.3</span>
              </div>
              <span className="gs-dock-badge">always visible</span>
            </div>
            <div className="gs-nav">
              <span className="gs-nav-item gs-nav-item--active">FEED</span>
              <span className="gs-nav-item">STACK</span>
            </div>
          </AsciiBox>
        </section>

        {/* ── § 3  row grammar ───────────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 3 · ROW GRAMMAR — PARALLEL FORMATTING" />
          <div className="gs-note-line">
            <Note text="── Same grammar in Feed and Stack. Primary · secondary  [metadata right-aligned]." />
          </div>
          <AsciiBox>
            <div className="gs-grammar-caption">Feed (artist leads — it is the thing you seeded):</div>
            <FeedRow artist="Slowdive" station="WFMU 91.1" />
            <div className="gs-grammar-caption" style={{ marginTop: 10 }}>Stack (album leads — it is what you will listen to):</div>
            <StackRow album="Souvlaki" artist="Slowdive" keptCount={3} provenance="via WFMU · 2 days ago" />
            <div className="gs-grammar-note">
              Collapsed rows are always single-line. Expanding reveals byline + action.
            </div>
          </AsciiBox>
        </section>

        {/* ── § 4  feed ──────────────────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 4 · FEED — PHASE 1 (SCAN) + PHASE 2 (KEEP)" />

          <div className="gs-note-line">
            <Note text="── Collapsed: no artwork, no metadata content, single line." />
          </div>
          <AsciiBox label="ON AIR FOR YOUR SEEDS [CROSSING SECTION]">
            <FeedRow artist="Grouper" station="KEXP 90.3" />
          </AsciiBox>
          <div className="gs-annotation">
            <Note text="COLLAPSED — SINGLE LINE, EYE READS LEFT TO RIGHT" />
          </div>

          <div className="gs-note-line" style={{ marginTop: 14 }}>
            <Note text="── Expanded: byline + Keep (Phase 2). Coverage mark when metadata exists." />
          </div>
          <AsciiBox>
            <FeedRow
              artist="Slowdive"
              station="WFMU 91.1"
              expanded
              showDJ="Tompkins Sq. Showcase · Alison"
              nowPlaying={undefined}
              hasCoverage
              elapsed="4m"
            />
          </AsciiBox>
          <div className="gs-annotation-group">
            <Note text="FIRST TAP = EXPAND · SECOND TAP = TUNE" />
            <Note text="KEEP ON BYLINE ONLY — NO ACCIDENTAL KEEP FROM COLLAPSED ROW" />
            <Note text="* = INVESTIGATION SOURCES INDEXED (COVERAGE AUDIT)" />
          </div>

          <div className="gs-note-line" style={{ marginTop: 14 }}>
            <Note text="── Ghost row — 'missed while away'. Desaturated. Replay affordance." />
          </div>
          <AsciiBox label="MISSED WHILE AWAY [GHOST SECTION]">
            <FeedRow
              artist="Julia Holter"
              station="KCRB 89.9"
              ghost
              expanded
              showDJ="Morning Becomes Eclectic"
              ago="9h ago"
            />
            <FeedRow
              artist="Grouper"
              station="KEXP 90.3"
              ghost
              expanded
              showDJ="Late Night Nothing"
              ago="7h ago"
            />
          </AsciiBox>
          <div className="gs-annotation">
            <Note text="SAME GRAMMAR AS LIVE · GHOST = DESATURATED · REPLACES /ARCHIVE FOR CASUAL USE" />
          </div>
        </section>

        {/* ── § 5  stack ─────────────────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 5 · STACK — PHASE 3 (INVESTIGATE + LAUNCH)" />
          <div className="gs-note-line">
            <Note text="── Collapsed: album leads, artist secondary, keep count right. No artwork." />
          </div>
          <AsciiBox>
            <StackRow album="Souvlaki" artist="Slowdive" keptCount={3} provenance="via WFMU · 2 days ago" hasCoverage />
            <StackRow album="Grief's Infernal Flower" artist="Bell Witch" keptCount={1} provenance="via KFAI · 5 days ago" />
            <StackRow album="Have One On Me" artist="Joanna Newsom" keptCount={2} provenance="via WKCR · today" hasCoverage />
          </AsciiBox>
          <div className="gs-annotation">
            <Note text="COLLAPSED — TEXT ONLY, SINGLE LINE + PROVENANCE BYLINE" />
          </div>

          <div className="gs-note-line" style={{ marginTop: 14 }}>
            <Note text="── Expanded: kept tracks as sub-rows with provenance. Launch button appears." />
          </div>
          <AsciiBox>
            <StackRow
              album="Souvlaki"
              artist="Slowdive"
              keptCount={3}
              provenance="via WFMU · 2 days ago"
              hasCoverage
              expanded
              tracks={[
                { title: "Alison", via: "WFMU 91.1 · Tompkins Sq.", date: "Aug 10" },
                { title: "When the Sun Hits", via: "WKCRO 89.9 · Morning Show", date: "Aug 8" },
                { title: "40 Days", via: "WFMU 91.1", date: "Aug 5" },
              ]}
            />
          </AsciiBox>
          <div className="gs-annotation-group">
            <Note text="SUB-ROWS ARE PROVENANCE — NOT PLAYBACK TARGETS" />
            <Note text="ALBUM IS THE LAUNCH UNIT" />
            <Note text="↗ INVESTIGATE OPENS METADATA SHEET" />
          </div>
        </section>

        {/* ── § 6  album investigation sheet ─────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 6 · ALBUM INVESTIGATION SHEET (METADATA SURFACE)" />
          <div className="gs-note-line">
            <Note text="── Scraped sources surface HERE only — never on the live Feed." />
          </div>
          <AsciiBox>
            {/* sheet header */}
            <div className="gs-sheet-header">
              <span className="gs-sheet-back">← Stack</span>
              <span className="gs-sheet-title">Souvlaki*</span>
              <span className="gs-sheet-artist">· Slowdive</span>
              <span className="gs-sheet-launch">▶ launch</span>
            </div>
            <div className="gs-sheet-meta">3 tracks kept · most recent: WFMU · Aug 10</div>

            <div className="gs-sheet-section-head">SOURCES</div>
            <div className="gs-sources">
              <SourceCard
                label="Song Exploder"
                type="Interview"
                date="Ep. 245"
                excerpt={'Rachel Goswell and Neil Halstead walk through the recording of "Alison" at RAK Studios — the deliberate decision to bury the vocals in reverb as a compositional texture, not a production choice.'}
              />
              <SourceCard
                label="Sound on Sound"
                type="Production profile"
                date="Mar 1994"
                excerpt="Engineer Craig Leon on the signal chain for the Souvlaki sessions: Fender Jazzmaster → Akai S900 → SSL 4000G. The shimmer is a custom tremolo preset on a Eventide H3000."
              />
              <SourceCard
                label="Beato"
                type="Video essay"
                date="14 min"
                excerpt={'"What Makes This Song Great? — Alison by Slowdive." Beato breaks down the chord voicings and why the suspended 4th resolves nowhere you expect.'}
              />
              <SourceCard
                label="Pitchfork"
                type="Review · Best New Reissue"
                date="2023"
                excerpt={'"Souvlaki remains the most fully-realised record in the shoegaze canon — not because it is the loudest, but because it is the most honest about what silence is doing." 9.2'}
              />
            </div>

            <div className="gs-sheet-section-head gs-sheet-section-head--pending">NOT YET INDEXED</div>
            <div className="gs-sources">
              <SourceCard
                label="AllMusic"
                type="Editorial review"
                date="—"
                excerpt="Will appear when Lore indexes this source. Use * marker on the Stack row to track coverage."
                notIndexed
              />
              <SourceCard
                label="RYM"
                type="Community ratings"
                date="—"
                excerpt="Will appear when Lore indexes this source."
                notIndexed
              />
            </div>
          </AsciiBox>
          <div className="gs-annotation-group">
            <Note text="METADATA ONLY IN STACK — NOT ON LIVE FEED" />
            <Note text="NOT-YET-INDEXED SOURCES LISTED HONESTLY — EMPTY STATE IS VISIBLE, NOT HIDDEN" />
            <Note text="* ON ALBUM TITLE = DIAGNOSTIC COVERAGE MARKER" />
          </div>
        </section>

        {/* ── § 7  open questions ────────────────────────────────── */}
        <section className="gs-section">
          <Rule label="§ 7 · OPEN QUESTIONS" />
          <AsciiBox>
            {[
              { q: "Expand-then-tune vs tap-to-tune", detail: "First tap expands (byline + Keep visible). Second tap tunes. Adds friction but prevents accidental tunes and keeps collapsed feed scannable." },
              { q: "Art in the Stack", detail: "Minimal default is text-only album rows. Lens toggle to 3-col card grid with cover art?" },
              { q: "Selectors / pickers", detail: "Inside Show sheet only, or does Stack get a 'From selectors' lens?" },
              { q: "Stack sort options", detail: "Default: album-first by most-recently-kept. Add 'by station' sort (what has WFMU played that I've kept)?" },
              { q: "Ghost row prominence", detail: "Currently trails live feed. Under this model it replaces /archive for casual use — needs a time-gated 'last 48 hours' header?" },
            ].map((item, i) => (
              <div key={i} className="gs-oq-row">
                <span className="gs-oq-n">{String(i + 1).padStart(2, "0")}</span>
                <div className="gs-oq-body">
                  <div className="gs-oq-q">{item.q}</div>
                  <div className="gs-oq-detail">{item.detail}</div>
                </div>
              </div>
            ))}
          </AsciiBox>
        </section>

        <div className="gs-footer">
          Variant of INTERFACE_ARCHITECTURE.md · Task 89 ·{" "}
          <a href="/__mockup/preview/lore-unified-arch/UnifiedArch" className="gs-footer-link">
            warm-dark variant →
          </a>
        </div>

      </div>
    </div>
  );
}
