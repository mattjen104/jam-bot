/**
 * useHeroArt — resolves the hero art URL for the Dial front-door cover.
 *
 * Extracted from DialView.tsx. Probes iTunes → Cover Art Archive → library URL
 * → RUMOURS offscreen before committing so the displayed art is always cached.
 *
 * Returns:
 *   heroArt   — the best resolved artwork URL (initialises to RUMOURS)
 *   avatarUrl — the raw avatar URL (or RUMOURS as fallback); used to gate
 *               the fullscreen overlay (a null/empty URL would be invisible)
 */
import { useState, useEffect } from "react";
import { useMyAlbumAvatar } from "../lib/meHooks";
import { RUMOURS } from "../lib/rumours";
import { heroArtCandidates } from "../lib/artRes";
import { proxyArtUrl } from "../lib/proxyArt";

export function useHeroArt(): { heroArt: string; avatarUrl: string } {
  const { data: avatarData } = useMyAlbumAvatar();
  // Rumours is the universal fallback — ensures the topbar gradient always
  // renders even for brand-new users who haven't connected a library yet.
  const avatarUrl = avatarData?.current?.artworkUrl ?? avatarData?.candidates?.[0]?.artworkUrl ?? RUMOURS;
  // Pre-verified hero art. The topbar wash is a CSS background (no onError),
  // so a dead avatar URL would silently render nothing. Start with the local
  // RUMOURS asset (always loads), then swap to the real avatar art only once
  // the browser has confirmed it actually loads. The fullscreen hero reuses
  // the same resolved URL, so it's always a cached, known-good image.
  // Dedicated hi-res pipeline for the hero cover: look the album up by
  // artist + title on sources that serve true 1200px masters (iTunes, then
  // Cover Art Archive by release-group), then fall back to the upscaled or
  // original library URL, then RUMOURS. Each candidate is probed offscreen,
  // so whichever wins is fully cached before it's ever displayed — the
  // moon-tap hero appears instantly at full quality.
  const avatarAlbum = avatarData?.current ?? avatarData?.candidates?.[0] ?? null;
  const [heroArt, setHeroArt] = useState<string>(RUMOURS);

  // When there's no resolvable avatar art, the hero is the RUMOURS fallback.
  // Reset to it during render (keyed on the resolved avatar) instead of
  // synchronously in the effect, which then only performs async probing.
  const canResolve = Boolean(avatarAlbum) && Boolean(avatarUrl) && avatarUrl !== RUMOURS;
  const [prevKey, setPrevKey] = useState<string | null>(canResolve ? avatarUrl : null);
  const key = canResolve ? avatarUrl : null;
  if (prevKey !== key) {
    setPrevKey(key);
    if (!canResolve && heroArt !== RUMOURS) setHeroArt(RUMOURS);
  }

  useEffect(() => {
    if (!avatarAlbum || !avatarUrl || avatarUrl === RUMOURS) return;
    let cancelled = false;
    void heroArtCandidates(avatarAlbum).then((urls) => {
      if (cancelled) return;
      const candidates = urls.map((u) => proxyArtUrl(u) ?? u);
      const tryLoad = (i: number) => {
        if (cancelled) return;
        if (i >= candidates.length) { setHeroArt(RUMOURS); return; }
        const probe = new Image();
        probe.onload = () => { if (!cancelled) setHeroArt(candidates[i]); };
        probe.onerror = () => tryLoad(i + 1);
        probe.src = candidates[i];
      };
      tryLoad(0);
    });
    return () => { cancelled = true; };
    // avatarUrl is derived from avatarAlbum; keying on it keeps deps simple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarAlbum?.recordingMbid, avatarUrl]);

  return { heroArt, avatarUrl };
}
