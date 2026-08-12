/**
 * Lore Unified Minimal Interface — Annotated Architecture Mockup
 *
 * Shows all three phases in one scroll:
 *   Phase 1 — Feed (live crossing rows, ghost row)
 *   Phase 2 — Keep (dock + expanded row)
 *   Phase 3 — Stack (album cards + Album Investigation sheet)
 *
 * Every annotation callout corresponds to a decision in
 * artifacts/lore/INTERFACE_ARCHITECTURE.md.
 */
import "./_group.css";

/* ─── tiny React-free helpers ──────────────────────────────────────── */

function Dot() {
  return <span className="ua-dot">·</span>;
}

function Note({ text, variant = "" }: { text: string; variant?: string }) {
  return <span className={`ua-note ${variant}`}>{text}</span>;
}

function Callout({ text }: { text: string }) {
  return <div className="ua-callout">{text}</div>;
}

/* Coverage mark: shown only when scraped metadata exists for this artist/album */
function CoverageMark({ title = "Investigation sources available" }: { title?: string }) {
  return (
    <span
      className="ua-coverage-mark"
      title={title}
      aria-label={title}
    >
      ✳
    </span>
  );
}

/* ─── Feed row components ───────────────────────────────────────────── */

function LiveDot() {
  return <span className="ua-live-dot" aria-label="live" />;
}

interface FeedRowProps {
  artist: string;
  station: string;
  meta?: React.ReactNode;
  expanded?: boolean;
  showDJ?: string;
  nowPlaying?: string;
  keepLabel?: string;
  ghost?: boolean;
  replayLabel?: string;
  hasCoverage?: boolean;
}

function FeedRow({
  artist,
  station,
  meta,
  expanded,
  showDJ,
  nowPlaying,
  keepLabel,
  ghost,
  replayLabel,
  hasCoverage,
}: FeedRowProps) {
  return (
    <div className={`ua-row ${ghost ? "ua-row-ghost" : ""}`}>
      {/* ── collapsed line: primary · secondary [metadata] ── */}
      <div className="ua-row-head">
        <span className="ua-row-primary">
          {artist}
          {hasCoverage && <CoverageMark />}
        </span>
        <Dot />
        <span className="ua-row-secondary">{station}</span>
        <span className="ua-row-meta">
          {meta}
        </span>
      </div>
      {/* ── expanded byline: show · now-playing [Keep / Replay] ── */}
      {expanded && (
        <div className="ua-row-byline">
          <span className="ua-row-byline-text">
            {showDJ && <>{showDJ}</>}
            {showDJ && nowPlaying && <Dot />}
            {nowPlaying && <>{nowPlaying}</>}
          </span>
          {keepLabel && (
            <span className="ua-row-byline-action">{keepLabel}</span>
          )}
          {replayLabel && (
            <span className="ua-row-byline-action" style={{ color: "var(--ua-text-muted)", borderColor: "var(--ua-border-hi)" }}>
              {replayLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Stack row components ──────────────────────────────────────────── */

interface StackRowProps {
  album: string;
  artist: string;
  keptCount: number;
  provenance: string;
  expanded?: boolean;
  tracks?: { title: string; station: string; dj?: string; date: string }[];
  hasCoverage?: boolean;
}

function StackRow({
  album,
  artist,
  keptCount,
  provenance,
  expanded,
  tracks,
  hasCoverage,
}: StackRowProps) {
  return (
    <div>
      <div className="ua-row">
        {/* collapsed head */}
        <div className="ua-row-head">
          <span className="ua-row-primary">
            {album}
            {hasCoverage && <CoverageMark title="Album investigation sources available" />}
          </span>
          <Dot />
          <span className="ua-row-secondary">{artist}</span>
          <span className="ua-row-meta">
            <span style={{ color: "var(--ua-accent)", fontWeight: 600 }}>{keptCount} kept</span>
          </span>
        </div>
        {/* provenance byline */}
        <div className="ua-row-byline">
          <span className="ua-row-byline-text" style={{ fontSize: 11, color: "var(--ua-text-muted)" }}>
            {provenance}
          </span>
          {expanded && (
            <span className="ua-btn-launch" style={{ fontSize: 10, padding: "2px 10px" }}>▶ launch</span>
          )}
        </div>
      </div>

      {/* expanded sub-rows */}
      {expanded && tracks && (
        <div style={{ background: "var(--ua-surface-2)" }}>
          {tracks.map((t, i) => (
            <div key={i} className="ua-subrow">
              <span className="ua-subrow-primary">{t.title}</span>
              <Dot />
              <span className="ua-subrow-secondary">
                {t.station}{t.dj ? ` · ${t.dj}` : ""}
              </span>
              <span className="ua-subrow-meta">{t.date}</span>
            </div>
          ))}
          {/* investigate affordance */}
          <div
            style={{
              padding: "8px 14px 8px 26px",
              borderTop: "1px solid var(--ua-border)",
              fontFamily: "var(--ua-mono)",
              fontSize: 11,
              color: "var(--ua-inv)",
              cursor: "pointer",
            }}
          >
            ↗ investigate · sources indexed
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Source card (Album Investigation sheet) ───────────────────────── */

interface SourceCardProps {
  label: string;
  type: string;
  date: string;
  excerpt: string;
  notIndexed?: boolean;
}

function SourceCard({ label, type, date, excerpt, notIndexed }: SourceCardProps) {
  return (
    <div className={`ua-source-card ${notIndexed ? "not-indexed" : ""}`}>
      <div className="ua-source-card-head">
        <span className="ua-source-label">{label}</span>
        <span className="ua-source-type">· {type}</span>
        <span className="ua-source-date">{date}</span>
      </div>
      <p className="ua-source-excerpt">{excerpt}</p>
      {!notIndexed && <span className="ua-source-link">↗ open</span>}
    </div>
  );
}

/* ─── Main mockup ───────────────────────────────────────────────────── */

export function UnifiedArch() {
  return (
    <div className="lore-ua" style={{ padding: "24px 16px 60px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* HEADER                                                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            Lore — Unified Minimal Interface
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--ua-text)", fontFamily: "var(--ua-mono)" }}>
            Architecture Mockup
          </h1>
          <p style={{ fontSize: 13, color: "var(--ua-text-sec)", marginTop: 4 }}>
            Annotated reference for Task 89. Every callout corresponds to a decision in{" "}
            <code style={{ fontFamily: "var(--ua-mono)", fontSize: 11, color: "var(--ua-accent)" }}>
              INTERFACE_ARCHITECTURE.md
            </code>.
            Dashed annotation labels are not production UI.
          </p>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 1 — THREE-PHASE LOOP DIAGRAM                       */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 1 · The Three-Phase Loop
          </div>
          <div style={{
            background: "var(--ua-surface)",
            border: "1px solid var(--ua-border)",
            borderRadius: 10,
            padding: "16px 20px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            {[
              { phase: "01 · SCAN", label: "Feed", desc: "Seeded artists on air anywhere on the network", color: "var(--ua-live)" },
              { phase: "02 · KEEP", label: "Dock / expanded row", desc: "Tap Keep. Provenance captured. No navigation.", color: "var(--ua-accent)" },
              { phase: "03 · STACK", label: "Stack", desc: "Albums to investigate. Launch when ready.", color: "var(--ua-inv)" },
            ].map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: "var(--ua-mono)", fontSize: 10, color: "var(--ua-text-muted)", minWidth: 90 }}>{p.phase}</span>
                <span
                  style={{
                    fontFamily: "var(--ua-mono)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: p.color,
                    minWidth: 120,
                    border: `1px solid ${p.color}`,
                    borderRadius: 4,
                    padding: "1px 7px",
                    textAlign: "center",
                  }}
                >{p.label}</span>
                <span style={{ fontSize: 13, color: "var(--ua-text-sec)" }}>{p.desc}</span>
                {i < 2 && (
                  <span style={{ marginLeft: "auto", fontFamily: "var(--ua-mono)", fontSize: 14, color: "var(--ua-border-hi)" }}>↓</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 2 — NAV SHAPE                                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 2 · Navigation (portrait / bottom nav)
          </div>
          <Callout text="Two labels only. No secondary tabs. Player dock always visible above nav." />
          <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
            {/* mock dock */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--ua-border)" }}>
              <div className="ua-dock">
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--ua-accent-dim)", border: "1px solid rgba(155,140,245,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <span style={{ fontSize: 14 }}>▮</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--ua-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Sleep · Dopesmoker</div>
                  <div style={{ fontSize: 11, color: "var(--ua-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                    <LiveDot />
                    <span>KFAI 90.3</span>
                  </div>
                </div>
                <Note text="player dock · always visible" />
              </div>
            </div>
            {/* mock bottom nav */}
            <div className="ua-nav">
              <div className="ua-nav-item active">feed</div>
              <div className="ua-nav-item">stack</div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 3 — ROW GRAMMAR                                    */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 3 · Row Grammar — the principle of parallel formatting
          </div>
          <Callout text="One grammar used in both Feed and Stack. Most important entity leads, dot separator, secondary entity, metadata right-aligned." />

          {/* Grammar diagram */}
          <div style={{
            background: "var(--ua-surface)",
            border: "1px solid var(--ua-border)",
            borderRadius: 10,
            padding: "14px 16px",
            fontFamily: "var(--ua-mono)",
            fontSize: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            <div style={{ color: "var(--ua-text-muted)", fontSize: 10, marginBottom: 4 }}>Feed (artist leads — it is the thing you seeded):</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 0, background: "var(--ua-surface-2)", padding: "8px 10px", borderRadius: 6 }}>
              <span style={{ color: "var(--ua-text)", fontWeight: 700 }}>Slowdive</span>
              <span style={{ color: "var(--ua-text-muted)", margin: "0 6px" }}>·</span>
              <span style={{ color: "var(--ua-text-muted)" }}>WFMU 91.1</span>
              <span style={{ marginLeft: "auto", paddingLeft: 10, color: "var(--ua-live)", display: "flex", alignItems: "center", gap: 4 }}>
                <LiveDot /><span style={{ fontSize: 10 }}>live</span>
              </span>
            </div>
            <div style={{ color: "var(--ua-text-muted)", fontSize: 10, marginTop: 6, marginBottom: 4 }}>Stack (album leads — it is what you will listen to):</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 0, background: "var(--ua-surface-2)", padding: "8px 10px", borderRadius: 6 }}>
              <span style={{ color: "var(--ua-text)", fontWeight: 700 }}>Souvlaki</span>
              <span style={{ color: "var(--ua-text-muted)", margin: "0 6px" }}>·</span>
              <span style={{ color: "var(--ua-text-muted)" }}>Slowdive</span>
              <span style={{ marginLeft: "auto", paddingLeft: 10, color: "var(--ua-accent)", fontFamily: "var(--ua-mono)", fontSize: 11, fontWeight: 600 }}>
                3 kept
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--ua-text-muted)", marginTop: 4, lineHeight: 1.6 }}>
              Same grammar, different priority. Feed leads with artist. Stack leads with album.
              <br />
              Collapsed rows are always single-line. Expanding reveals byline + action.
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 4 — FEED (PHASE 1 + 2)                             */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 4 · Feed — Phase 1 (Scan) + Phase 2 (Keep)
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Callout text="Live crossing row, COLLAPSED — no artwork, no metadata content, single line." />
            <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
              <div className="ua-section-header">
                On air for your seeds <Note text="crossing section" />
              </div>
              <FeedRow
                artist="Grouper"
                station="KEXP 90.3"
                meta={<><LiveDot /><span style={{ fontSize: 10, color: "var(--ua-live)" }}>live</span></>}
              />
            </div>
            <div style={{ marginTop: 2 }}>
              <Note text="collapsed — single line, no actions visible, eye reads left to right" />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <Callout text="Live crossing row, EXPANDED — byline + Keep (Phase 2). Coverage marker on artist with metadata." />
            <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
              <FeedRow
                artist="Slowdive"
                station="WFMU 91.1"
                meta={<><LiveDot /><span style={{ fontSize: 10, color: "var(--ua-live)" }}>live · 4m</span></>}
                expanded
                showDJ="Tompkins Sq. Showcase"
                nowPlaying="Alison"
                keepLabel="+ Keep"
                hasCoverage
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <Note text="first tap = expand · second tap = tune" />
              <Note text="keep on byline only — no accidental keep from collapsed row" variant="accent" />
              <Note text="✳ = investigation sources indexed (coverage audit)" variant="inv" />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <Callout text="Ghost row — 'missed while away'. Same grammar, desaturated, replay affordance." />
            <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
              <div className="ua-section-header">
                Missed while away <Note text="ghost section" variant="ghost" />
              </div>
              <FeedRow
                artist="Julia Holter"
                station="KCRW 89.9"
                meta={<span style={{ fontSize: 11 }}>3h ago</span>}
                expanded
                showDJ="Morning Becomes Eclectic"
                ghost
                replayLabel="→ replay"
              />
              <FeedRow
                artist="Grouper"
                station="KEXP 90.3"
                meta={<span style={{ fontSize: 11 }}>7h ago</span>}
                expanded
                showDJ="Late Night Nothing"
                ghost
                replayLabel="→ replay"
                hasCoverage
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <Note text="same row grammar as live — ghost = desaturated variant" variant="ghost" />
              <Note text="replaces /archive for casual discovery use" variant="ghost" />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 5 — STACK (PHASE 3)                                */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 5 · Stack — Phase 3 (Investigate + Launch)
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Callout text="Stack collapsed — album leads, artist secondary, keep count right. No artwork in minimal mode." />
            <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
              <StackRow
                album="Souvlaki"
                artist="Slowdive"
                keptCount={3}
                provenance="via WFMU · 2 days ago"
                hasCoverage
              />
              <StackRow
                album="Grief's Infernal Flower"
                artist="Bell Witch"
                keptCount={1}
                provenance="via KFAI · 5 days ago"
              />
              <StackRow
                album="Have One On Me"
                artist="Joanna Newsom"
                keptCount={2}
                provenance="via WKCR · today"
                hasCoverage
              />
            </div>
            <Note text="collapsed — text only, single primary line + provenance byline" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
            <Callout text="Stack EXPANDED — kept tracks as sub-rows with provenance, launch button, investigate affordance." />
            <div style={{ background: "var(--ua-surface)", border: "1px solid var(--ua-border)", borderRadius: 10, overflow: "hidden" }}>
              <StackRow
                album="Souvlaki"
                artist="Slowdive"
                keptCount={3}
                provenance="via WFMU · 2 days ago"
                expanded
                hasCoverage
                tracks={[
                  { title: "Alison", station: "WFMU 91.1", dj: "Tompkins Sq.", date: "Aug 10" },
                  { title: "When the Sun Hits", station: "WKCRG 89.9", dj: "Morning Show", date: "Aug 8" },
                  { title: "40 Days", station: "WFMU 91.1", date: "Aug 5" },
                ]}
              />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <Note text="sub-rows are provenance — not playback targets" />
              <Note text="album is the launch unit" variant="accent" />
              <Note text="↗ investigate opens metadata sheet" variant="inv" />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 6 — ALBUM INVESTIGATION SHEET                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 6 · Album Investigation Sheet (metadata surface)
          </div>
          <Callout text="Scraped sources are ONLY surfaced here — not on the live Feed. Reviews, Song Exploder, Beato, Sound on Sound, etc." />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div className="ua-sheet">
              <div className="ua-sheet-header">
                <span className="ua-sheet-back">← Stack</span>
                <span className="ua-sheet-title">Souvlaki<CoverageMark title="Investigation sources available" /></span>
                <span className="ua-sheet-artist">· Slowdive</span>
                <span className="ua-btn-launch">▶ launch</span>
              </div>
              {/* provenance block */}
              <div style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--ua-border)",
                fontSize: 12,
                color: "var(--ua-text-muted)",
                fontFamily: "var(--ua-mono)",
                display: "flex",
                gap: 12,
              }}>
                <span>3 tracks kept</span>
                <span>·</span>
                <span>most recent: WFMU · Aug 10</span>
              </div>

              {/* indexed sources */}
              <div className="ua-divider-label">Sources</div>
              <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
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
                  excerpt={"Engineer Craig Leon on the signal chain for the Souvlaki sessions: Fender Jazzmaster → Akai S900 → SSL 4000G. The shimmer is a custom tremolo preset on a Eventide H3000."}
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

              {/* not-yet-indexed */}
              <div className="ua-divider-label" style={{ color: "var(--ua-text-muted)", opacity: 0.6 }}>Not yet indexed</div>
              <div style={{ padding: "0 12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <SourceCard
                  label="AllMusic"
                  type="Critical summary"
                  date="—"
                  excerpt="Will appear when Lore indexes this source. Use ✳ marker on the Stack row to track coverage."
                  notIndexed
                />
                <SourceCard
                  label="RYM"
                  type="Rating · community reviews"
                  date="—"
                  excerpt="Will appear when Lore indexes this source."
                  notIndexed
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
              <Note text="metadata only in Stack — not on live Feed" variant="inv" />
              <Note text="not-yet-indexed sources listed honestly — empty state is visible, not hidden" variant="ghost" />
              <Note text="✳ on album title = diagnostic coverage marker" variant="inv" />
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 7 — COVERAGE MARKER EXPLAINED                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 7 · Coverage Marker ✳ — audit path, no inline content
          </div>
          <div style={{
            background: "var(--ua-surface)",
            border: "1px solid var(--ua-border)",
            borderRadius: 10,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontFamily: "var(--ua-mono)", fontSize: 11, color: "var(--ua-text-muted)" }}>On a Feed row (expanded):</div>
              <div style={{ background: "var(--ua-surface-2)", borderRadius: 6, padding: "8px 12px", fontFamily: "var(--ua-mono)", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>Slowdive</span>
                <span style={{ fontSize: 9, color: "var(--ua-inv)", verticalAlign: "super", marginLeft: 1 }}>✳</span>
                <span style={{ color: "var(--ua-text-muted)" }}> · WFMU 91.1</span>
                <span style={{ marginLeft: "auto", float: "right", fontSize: 11, color: "var(--ua-text-muted)" }}>tooltip on hover: "Investigation sources available"</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ua-text-muted)", lineHeight: 1.6 }}>
                Tapping <code style={{ fontFamily: "var(--ua-mono)", fontSize: 11 }}>✳</code> on the Feed opens the Artist sheet which shows coverage count.
                No metadata content appears inline. The Feed stays scannable.
              </div>
            </div>
            <div style={{ height: 1, background: "var(--ua-border)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontFamily: "var(--ua-mono)", fontSize: 11, color: "var(--ua-text-muted)" }}>On a Stack row (collapsed + expanded):</div>
              <div style={{ background: "var(--ua-surface-2)", borderRadius: 6, padding: "8px 12px", fontFamily: "var(--ua-mono)", fontSize: 13 }}>
                <span style={{ fontWeight: 700 }}>Souvlaki</span>
                <span style={{ fontSize: 9, color: "var(--ua-inv)", verticalAlign: "super", marginLeft: 1 }}>✳</span>
                <span style={{ color: "var(--ua-text-muted)" }}> · Slowdive</span>
                <span style={{ marginLeft: "auto", float: "right", fontSize: 11, color: "var(--ua-accent)", fontWeight: 600 }}>3 kept</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--ua-text-muted)", lineHeight: 1.6 }}>
                Tapping <code style={{ fontFamily: "var(--ua-mono)", fontSize: 11 }}>✳</code> on the Stack goes directly to the Album Investigation sheet.
              </div>
            </div>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 8 — SHEET HIERARCHY (summary)                      */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 8 · Sheet Hierarchy — all drill-downs are sheets, not routes
          </div>
          <div style={{
            background: "var(--ua-surface)",
            border: "1px solid var(--ua-border)",
            borderRadius: 10,
            overflow: "hidden",
          }}>
            {[
              { sheet: "Station sheet", from: "Any station name in Feed or Stack", replaces: "/archive/stations/:slug" },
              { sheet: "Show sheet", from: "Station sheet or ghost row replay", replaces: "/archive/station-runs/:runId" },
              { sheet: "Artist sheet", from: "Any artist name (coverage audit path)", replaces: "/dj/:name, /selectors" },
              { sheet: "Song sheet", from: "Keep or tracklist sub-row", replaces: "(new — from keep flow)" },
              { sheet: "Album Investigation", from: "Stack expanded ↗ or ✳ marker", replaces: "(new — metadata layer)" },
            ].map((r, i) => (
              <div key={i} style={{
                padding: "10px 14px",
                borderBottom: i < 4 ? "1px solid var(--ua-border)" : "none",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}>
                <span style={{ fontFamily: "var(--ua-mono)", fontSize: 12, fontWeight: 700, color: "var(--ua-text)", minWidth: 160 }}>{r.sheet}</span>
                <span style={{ fontSize: 12, color: "var(--ua-text-sec)", flex: 1, minWidth: 180 }}>{r.from}</span>
                <span style={{ fontFamily: "var(--ua-mono)", fontSize: 10, color: "var(--ua-text-muted)", whiteSpace: "nowrap" }}>replaces: {r.replaces}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Note text="internal nav always opens sheet — full-page routes exist for share links only" />
            <Note text="two levels deep max · closing returns to scroll position" variant="ghost" />
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════ */}
        {/* SECTION 9 — OPEN QUESTIONS                                 */}
        {/* ═══════════════════════════════════════════════════════════ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ua-text-muted)" }}>
            § 9 · Open Questions — decisions required before implementation
          </div>
          <div style={{
            background: "var(--ua-surface)",
            border: "1px solid var(--ua-border)",
            borderRadius: 10,
            overflow: "hidden",
          }}>
            {[
              { q: "Expand-then-tune vs tap-to-tune", note: "Spec defaults to expand-first. Revisit after first sprint." },
              { q: "Art in the Stack", note: "Minimal default = text only. Lens toggle or expanded-only?" },
              { q: "Selectors / pickers placement", note: "Show sheet only, or a 'Curated' lens in the Stack?" },
              { q: "Stack sort options", note: "Default = most-recently-kept. Add 'by station' sort?" },
              { q: "Ghost row prominence", note: "Trailing feed, time-gated header, or ghost-first when no live crossings?" },
              { q: "Coverage audit tool depth", note: "In-app ✳ only, or also admin report / CLI command?" },
            ].map((r, i, arr) => (
              <div key={i} style={{
                padding: "10px 14px",
                borderBottom: i < arr.length - 1 ? "1px solid var(--ua-border)" : "none",
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "flex-start",
              }}>
                <span style={{ fontFamily: "var(--ua-mono)", fontSize: 12, color: "var(--ua-text)", minWidth: 200 }}>? {r.q}</span>
                <span style={{ fontSize: 12, color: "var(--ua-text-muted)", flex: 1 }}>{r.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* footer */}
        <div style={{ fontFamily: "var(--ua-mono)", fontSize: 10, color: "var(--ua-text-muted)", textAlign: "center", paddingTop: 8 }}>
          Task 89 · Lore Unified Minimal Interface Architecture · artifacts/lore/INTERFACE_ARCHITECTURE.md
        </div>

      </div>
    </div>
  );
}

export default UnifiedArch;
