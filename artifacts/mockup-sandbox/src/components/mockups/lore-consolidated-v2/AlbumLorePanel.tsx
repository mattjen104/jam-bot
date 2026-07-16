import "./_group.css";

const html = `
<div style="background: var(--surface-1); border-radius: 12px; padding: 20px; border:1px solid var(--border);">
<div style="background: var(--surface-2); border: 0.5px solid var(--border); border-radius: 12px; overflow: hidden;">

  <div style="padding: 16px 18px; border-bottom: 0.5px solid var(--border); display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
    <div style="width: 52px; height: 52px; border-radius: var(--radius); background: var(--bg-accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><i class="ti ti-disc" style="font-size: 24px; color: var(--text-accent);" aria-hidden="true"></i></div>
    <div style="min-width: 0; flex: 1;">
      <p style="margin: 0; font-size: 16px; font-weight: 500;">Mirror Reaper · Bell Witch</p>
      <p style="margin: 2px 0 0; font-size: 13px; color: var(--text-secondary);">2017 · Profound Lore <span style="color: var(--text-muted);">· spinning now on</span> Drone Not Drones</p>
    </div>
    <span style="font-size: 12px; padding: 4px 10px; border-radius: 999px; background: var(--bg-pro); color: var(--text-pro); white-space: nowrap;"><i class="ti ti-book-2" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> 6 artifacts</span>
  </div>

  <div style="padding: 14px 18px; border-bottom: 0.5px solid var(--border);">
    <p style="margin: 0 0 10px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">PROVENANCE</p>
    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
      <span style="font-size: 13px; padding: 5px 11px; border: 0.5px solid var(--border-strong); border-radius: 999px;"><i class="ti ti-list" style="font-size: 13px; vertical-align: -2px; color: var(--text-muted);" aria-hidden="true"></i> Doom canon · season 2, week 4</span>
      <span style="font-size: 13px; padding: 5px 11px; border: 0.5px solid var(--border-strong); border-radius: 999px;"><i class="ti ti-user" style="font-size: 13px; vertical-align: -2px; color: var(--text-muted);" aria-hidden="true"></i> Low Tide · spun 4x</span>
      <span style="font-size: 13px; padding: 5px 11px; border: 0.5px solid var(--border-strong); border-radius: 999px;"><i class="ti ti-user" style="font-size: 13px; vertical-align: -2px; color: var(--text-muted);" aria-hidden="true"></i> Mara V · séance May 3</span>
      <span style="font-size: 13px; padding: 5px 11px; border: 0.5px solid var(--border-strong); border-radius: 999px; color: var(--text-success);"><i class="ti ti-check" style="font-size: 13px; vertical-align: -2px;" aria-hidden="true"></i> in your library since 2021</span>
    </div>
  </div>

  <div style="padding: 14px 18px 16px;">
    <p style="margin: 0 0 10px; font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);">GO DEEPER</p>

    <a href="https://www.soundonsound.com" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 0.5px solid var(--border);">
      <i class="ti ti-file-text" style="font-size: 18px; color: var(--text-secondary); flex-shrink: 0;" aria-hidden="true"></i>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px; font-weight: 500;">Recording an 83-minute single track</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">Sound on Sound · Billy Anderson on tracking bass and organ as one instrument</p>
      </div>
      <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap;">READ · 12 min <i class="ti ti-external-link" style="font-size: 12px; vertical-align: -2px;" aria-hidden="true"></i></span>
    </a>

    <a href="https://www.youtube.com" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 0.5px solid var(--border);">
      <i class="ti ti-video" style="font-size: 18px; color: var(--text-secondary); flex-shrink: 0;" aria-hidden="true"></i>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px; font-weight: 500;">Dylan Desmond on writing after loss</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">Rick Beato · the album as memorial for Adrian Guerra</p>
      </div>
      <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap;">WATCH · 48 min <i class="ti ti-external-link" style="font-size: 12px; vertical-align: -2px;" aria-hidden="true"></i></span>
    </a>

    <a href="https://songexploder.net" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 0.5px solid var(--border);">
      <i class="ti ti-headphones" style="font-size: 18px; color: var(--text-secondary); flex-shrink: 0;" aria-hidden="true"></i>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px; font-weight: 500;">Deconstructing the funeral bell motif</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">Song Exploder-style breakdown · stems and intent, in the band's words</p>
      </div>
      <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap;">LISTEN · 24 min <i class="ti ti-external-link" style="font-size: 12px; vertical-align: -2px;" aria-hidden="true"></i></span>
    </a>

    <a href="https://musicbrainz.org" style="text-decoration: none; color: inherit; display: flex; align-items: center; gap: 12px; padding: 10px 0;">
      <i class="ti ti-notes" style="font-size: 18px; color: var(--text-secondary); flex-shrink: 0;" aria-hidden="true"></i>
      <div style="min-width: 0; flex: 1;">
        <p style="margin: 0; font-size: 14px; font-weight: 500;">Liner notes and credits</p>
        <p style="margin: 2px 0 0; font-size: 12px; color: var(--text-secondary);">Full personnel, artwork by Mariusz Lewandowski · via MusicBrainz</p>
      </div>
      <span style="font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); white-space: nowrap;">CREDITS <i class="ti ti-external-link" style="font-size: 12px; vertical-align: -2px;" aria-hidden="true"></i></span>
    </a>
  </div>

</div>
</div>
`;

export default function AlbumLorePanel() {
  return (
    <div className="lore-v2">
      <div className="wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
