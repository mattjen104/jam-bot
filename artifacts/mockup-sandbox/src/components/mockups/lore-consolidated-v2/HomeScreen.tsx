import "./_group.css";

const html = `
<div style="background: var(--surface-1); border-radius: 12px; padding: 20px; border:1px solid var(--border);">

<section style="padding: 18px 2px 26px;">
  <p style="margin: 0 0 11px; color: var(--text-accent); font: 10px var(--font-mono); letter-spacing: .16em; text-transform: uppercase;">LORE / PLAYER</p>
  <h1 style="max-width: 680px; margin: 0; color: var(--text-primary); font: 400 clamp(38px, 7vw, 68px)/.98 Georgia, serif; letter-spacing: -.045em;">Radio in motion.</h1>
  <p style="max-width: 560px; margin: 14px 0 21px; color: var(--text-secondary); font-size: 18px; line-height: 1.35;">Add artists to see which stations are playing your music.</p>
  <form aria-label="Add artists" style="display:flex; align-items:center; gap:10px; max-width:680px; min-height:54px; padding:6px 8px 6px 16px; background:#211f1a; border:1px solid var(--border-strong); border-radius:10px;">
    <span aria-hidden="true" style="color:var(--text-accent); font:17px var(--font-mono);">&gt;_</span>
    <input aria-label="Add artists" placeholder="/add Radiohead, Grouper" style="min-width:0; flex:1; padding:7px 0; color:var(--text-primary); background:transparent; border:0; outline:0; font:14px var(--font-mono);" />
    <button type="button" style="padding:7px 14px; background:var(--fill-primary); color:var(--on-primary); border-color:var(--fill-primary); font-size:13px; font-weight:600;">Add</button>
  </form>
  <p style="margin:9px 0 0; color:var(--text-muted); font:11px var(--font-mono);">Type <span style="color:var(--text-secondary);">/add artist, artist</span> and press Enter</p>
</section>

<div class="motion-now-playing" style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; padding: 14px 16px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
  <button aria-label="Pause" style="width: 44px; height: 44px; border-radius: 50%; background: var(--fill-primary); color: var(--on-primary); border: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i class="ti ti-player-pause" style="font-size: 20px;" aria-hidden="true"></i></button>
  <div class="motion-now-playing__copy" style="min-width: 0; flex: 1;">
    <p style="margin: 0; font-size: 15px; font-weight: 500;">Dopesmoker · Sleep</p>
    <p style="margin: 2px 0 0; font-size: 13px; color: var(--text-secondary);">Drone Not Drones <span style="color: var(--text-muted);">· via</span> <span style="font-family: var(--font-mono); font-size: 12px;">KFAI 90.3</span> <span style="color: var(--text-muted);">· selector</span> Low Tide</p>
  </div>
  <div class="motion-now-playing__actions">
    <span style="font-size: 12px; padding: 4px 10px; border-radius: 999px; background: var(--bg-success); color: var(--text-success); white-space: nowrap;"><i class="ti ti-check" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> in your library</span>
    <button aria-label="Keep this track" style="white-space: nowrap;"><i class="ti ti-bookmark" style="font-size: 15px; vertical-align: -2px;" aria-hidden="true"></i> Keep</button>
  </div>
</div>

<div style="display: flex; align-items: center; gap: 12px; margin: 12px 0 20px; padding: 10px 16px; background: var(--bg-accent); border-radius: var(--radius);">
  <i class="ti ti-refresh" style="font-size: 16px; color: var(--text-accent);" aria-hidden="true"></i>
  <p style="margin: 0; font-size: 13px; color: var(--text-accent); flex: 1;">Reading your Spotify library · 1,204 / 3,487 tracks resolved — matches below update as we go</p>
  <div style="width: 120px; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden;"><div style="width: 34%; height: 100%; background: var(--fill-accent);"></div></div>
</div>

<div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
  <h3 style="margin: 0; font-size: 16px;">On the air</h3>
  <p style="margin: 0; font-size: 12px; color: var(--text-muted); font-family: var(--font-mono);">sorted by your overlap</p>
</div>

<div style="border: 0.5px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface-2);">

  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 0.5px solid var(--border);">
    <button aria-label="Play Drone Not Drones" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><i class="ti ti-player-play" style="font-size: 14px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Drone Not Drones <span style="font-size: 12px; color: var(--text-muted); font-weight: 400;">· Low Tide</span></p>
      <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">now: Sleep · earlier: Sunn O))), Earth, Bell Witch</p>
    </div>
    <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0;">KFAI 90.3</span>
    <span style="font-size: 12px; font-weight: 500; color: var(--text-success); flex-shrink: 0; min-width: 76px; text-align: right;">41 matches</span>
  </div>

  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 0.5px solid var(--border);">
    <button aria-label="Play Expansions" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><i class="ti ti-player-play" style="font-size: 14px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Expansions <span style="font-size: 12px; color: var(--text-muted); font-weight: 400;">· DJ Amir</span></p>
      <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">now: Alice Coltrane · earlier: Pharoah Sanders, Yusef Lateef</p>
    </div>
    <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0;">WEFUNK</span>
    <span style="font-size: 12px; font-weight: 500; color: var(--text-success); flex-shrink: 0; min-width: 76px; text-align: right;">17 matches</span>
  </div>

  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-bottom: 0.5px solid var(--border);">
    <button aria-label="Play Heavy Rotation" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><i class="ti ti-player-play" style="font-size: 14px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Heavy Rotation <span style="font-size: 12px; color: var(--text-muted); font-weight: 400;">· Mara V</span></p>
      <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">now: Cult of Luna · earlier: Amenra, Russian Circles</p>
    </div>
    <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0;">WZBC 90.3</span>
    <span style="font-size: 12px; font-weight: 500; color: var(--text-success); flex-shrink: 0; min-width: 76px; text-align: right;">12 matches</span>
  </div>

  <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px;">
    <button aria-label="Play Eclectic Breakfast" style="width: 32px; height: 32px; border-radius: 50%; padding: 0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;"><i class="ti ti-player-play" style="font-size: 14px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Eclectic Breakfast <span style="font-size: 12px; color: var(--text-muted); font-weight: 400;">· volunteer DJ</span></p>
      <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">resolving spins…</p>
    </div>
    <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); flex-shrink: 0;">KVSC 88.1</span>
    <span style="font-size: 12px; color: var(--text-muted); flex-shrink: 0; min-width: 76px; text-align: right;">—</span>
  </div>

</div>
</div>
`;

export default function HomeScreen() {
  return (
    <div className="lore-v2">
      <div className="wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
