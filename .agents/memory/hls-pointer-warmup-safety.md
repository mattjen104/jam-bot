---
name: HLS pointer warmup safety
description: Browser-safe warmup behavior for live HLS stations.
---

Do not pointer-preload an HLS URL by assigning it directly to an audio element when `canPlayType("application/vnd.apple.mpegurl")` is empty. Skip warmup and let hls.js attach the real attempt to a clean audio element.

**Why:** Chrome can begin a failed native load during pointer warmup. Reusing that element for hls.js can produce terminal playback failures even when the manifest, segments, and AAC audio are valid.

**How to apply:** Any live-radio warmup or preconnect path must distinguish native HLS support from hls.js support. Direct MP3/AAC warmup remains valid; non-native HLS starts only through the hls.js attachment path.