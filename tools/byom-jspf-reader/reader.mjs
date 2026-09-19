/**
 * Independent reader for Lore's BYOM/JSPF collection projection.
 *
 * This intentionally imports no Lore modules. It documents the small public
 * contract an outside client needs in order to retain ordered unresolved rows.
 */
export function readLoreJspf(document) {
  if (!document || typeof document !== "object") {
    throw new Error("JSPF document must be an object.");
  }
  const playlist = document.playlist;
  if (!playlist || typeof playlist !== "object" || Array.isArray(playlist)) {
    throw new Error("JSPF document must contain a playlist object.");
  }
  if (!Array.isArray(playlist.track)) {
    throw new Error("JSPF playlist must contain a track array.");
  }

  return {
    title: typeof playlist.title === "string" ? playlist.title : "Untitled collection",
    annotation: typeof playlist.annotation === "string" ? playlist.annotation : null,
    entries: playlist.track.map((raw, index) => {
      const track = raw && typeof raw === "object" ? raw : {};
      const meta = track.meta && typeof track.meta === "object" ? track.meta : {};
      const identity = typeof meta["lore:identity"] === "string"
        ? meta["lore:identity"]
        : "text";
      const unavailableReason = typeof meta["lore:unavailable"] === "string"
        ? meta["lore:unavailable"]
        : null;
      const unresolved = identity === "text" || identity === "unavailable";

      return {
        position: index + 1,
        title: typeof track.title === "string" ? track.title : null,
        artist: typeof track.creator === "string" ? track.creator : null,
        identity,
        status: unresolved ? "unresolved" : "resolved",
        unavailableReason,
      };
    }),
  };
}
