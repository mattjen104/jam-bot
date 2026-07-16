import "./_group.css";

const html = `
<div style="background: var(--surface-1); border-radius: 12px; padding: 20px; border:1px solid var(--border); display: flex; flex-direction: column; gap: 14px;">

<div>
  <p style="margin: 0 0 6px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">NOW PLAYING</p>
  <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <button aria-label="Pause" style="width: 36px; height: 36px; border-radius: 50%; background: var(--fill-primary); color: var(--on-primary); border: none; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i class="ti ti-player-pause" style="font-size: 16px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Mirror Reaper · Bell Witch</p>
      <p style="margin: 1px 0 0; font-size: 12px; color: var(--text-secondary);">Drone Not Drones · <span style="font-family: var(--font-mono); font-size: 11px;">KFAI 90.3</span></p>
    </div>
    <button style="font-size: 12px; padding: 4px 10px; border-radius: 999px; white-space: nowrap;"><i class="ti ti-book-2" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> 6 · 3 lists</button>
    <button style="font-size: 13px; white-space: nowrap;"><i class="ti ti-bookmark" style="font-size: 14px; vertical-align: -2px;" aria-hidden="true"></i> Keep</button>
  </div>
</div>

<div>
  <p style="margin: 0 0 6px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">IN A RUN DRAWER</p>
  <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <button aria-label="Play sample" style="width: 28px; height: 28px; border-radius: 50%; padding: 0; flex-shrink: 0;"><i class="ti ti-player-play" style="font-size: 12px;" aria-hidden="true"></i></button>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px;">Ragana — Desolation's Flower</p>
      <p style="margin: 1px 0 0; font-size: 12px; color: var(--text-muted);">spun 9:02 pm · new to you</p>
    </div>
    <button style="font-size: 12px; padding: 4px 10px; border-radius: 999px; white-space: nowrap;"><i class="ti ti-book-2" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> 2 · 1 list</button>
    <button style="font-size: 13px; white-space: nowrap;"><i class="ti ti-bookmark" style="font-size: 14px; vertical-align: -2px;" aria-hidden="true"></i> Keep</button>
  </div>
</div>

<div>
  <p style="margin: 0 0 6px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">IN YOUR LIBRARY</p>
  <div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; padding: 10px 14px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
    <div style="width: 36px; height: 36px; border-radius: var(--radius); background: var(--bg-accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i class="ti ti-disc" style="font-size: 18px; color: var(--text-accent);" aria-hidden="true"></i></div>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 14px; font-weight: 500;">Old Black · Earth</p>
      <p style="margin: 1px 0 0; font-size: 12px; color: var(--text-muted);">in your library · spun by 2 selectors you follow</p>
    </div>
    <button style="font-size: 12px; padding: 4px 10px; border-radius: 999px; white-space: nowrap;"><i class="ti ti-book-2" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> 4 · 2 lists</button>
    <button style="font-size: 13px; white-space: nowrap;"><i class="ti ti-broadcast" style="font-size: 14px; vertical-align: -2px;" aria-hidden="true"></i> Hear in runs</button>
  </div>
</div>

</div>
`;

export default function LoreChip() {
  return (
    <div className="lore-v2">
      <div className="wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
