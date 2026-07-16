import "./_group.css";

const html = `
<div style="background: var(--surface-1); border-radius: 12px; padding: 20px; border:1px solid var(--border);">
<div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; overflow: hidden;">

  <div style="padding: 16px 18px; border-bottom: 0.5px solid var(--border); display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 16px; font-weight: 500;">Drone Not Drones · tonight's run</p>
      <p style="margin: 3px 0 0; font-size: 13px; color: var(--text-secondary);">selector Low Tide <span style="color: var(--text-muted);">·</span> <span style="font-family: var(--font-mono); font-size: 12px;">KFAI 90.3</span> <span style="color: var(--text-muted);">· 14 spins so far</span></p>
    </div>
    <span style="font-size: 12px; padding: 4px 10px; border-radius: 999px; background: var(--bg-success); color: var(--text-success); white-space: nowrap;">78% taste overlap</span>
  </div>

  <div style="padding: 14px 18px 6px;">
    <p style="margin: 0 0 8px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">FROM YOUR LIBRARY · 6</p>
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0;">
      <i class="ti ti-check" style="font-size: 15px; color: var(--text-success); flex-shrink: 0;" aria-hidden="true"></i>
      <p style="margin: 0; font-size: 14px; flex: 1;">Bell Witch — Mirror Reaper</p>
      <span style="font-size: 12px; color: var(--text-muted);">9:14 pm</span>
    </div>
    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0;">
      <i class="ti ti-check" style="font-size: 15px; color: var(--text-success); flex-shrink: 0;" aria-hidden="true"></i>
      <p style="margin: 0; font-size: 14px; flex: 1;">Earth — Old Black</p>
      <span style="font-size: 12px; color: var(--text-muted);">8:51 pm</span>
    </div>
  </div>

  <div style="padding: 10px 18px 16px;">
    <p style="margin: 0 0 8px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">NEW TO YOU · 8</p>

    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 0.5px solid var(--border);">
      <button aria-label="Play sample" style="width: 28px; height: 28px; border-radius: 50%; padding: 0; flex-shrink: 0;"><i class="ti ti-player-play" style="font-size: 12px;" aria-hidden="true"></i></button>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px;">Ragana — Desolation's Flower</p>
        <p style="margin: 1px 0 0; font-size: 12px; color: var(--text-muted);">spun 9:02 pm · also kept by 213 listeners</p>
      </div>
      <button style="font-size: 13px;"><i class="ti ti-bookmark" style="font-size: 14px; vertical-align: -2px;" aria-hidden="true"></i> Keep</button>
    </div>

    <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0;">
      <button aria-label="Play sample" style="width: 28px; height: 28px; border-radius: 50%; padding: 0; flex-shrink: 0;"><i class="ti ti-player-play" style="font-size: 12px;" aria-hidden="true"></i></button>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px;">Kali Malone — Living Torch I</p>
        <p style="margin: 1px 0 0; font-size: 12px; color: var(--text-muted);">spun 8:37 pm</p>
      </div>
      <span style="font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--bg-accent); color: var(--text-accent); white-space: nowrap;">kept <i class="ti ti-arrow-right" style="font-size: 11px; vertical-align: -1px;" aria-hidden="true"></i> album queued</span>
    </div>
  </div>

  <div style="background: var(--surface-1); border-top: 0.5px solid var(--border); padding: 14px 18px;">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
      <div style="width: 34px; height: 34px; border-radius: 50%; background: var(--bg-accent); color: var(--text-accent); display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 500; flex-shrink: 0;">LT</div>
      <p style="margin: 0; font-size: 13px; color: var(--text-secondary); flex: 1;">You and Low Tide share 41 recordings. Deeper in their stacks, past runs you haven't heard:</p>
      <button style="font-size: 13px; white-space: nowrap;">Follow selector</button>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px;">
      <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px 12px;">
        <p style="margin: 0; font-size: 13px; font-weight: 500;">Divide and Dissolve</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">spun 4x across 3 runs</p>
      </div>
      <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px 12px;">
        <p style="margin: 0; font-size: 13px; font-weight: 500;">The Body</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">spun 3x · ghost run Apr 12</p>
      </div>
      <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: var(--radius); padding: 10px 12px;">
        <p style="margin: 0; font-size: 13px; font-weight: 500;">Big Brave</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-muted);">spun 2x · séance May 3</p>
      </div>
    </div>
  </div>

</div>
</div>
`;

export default function RunDrawer() {
  return (
    <div className="lore-v2">
      <div className="wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
