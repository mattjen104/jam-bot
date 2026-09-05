---
name: Local speech runtime portability
description: Resource and network-safety constraints discovered while provisioning the local radio speech pilot.
---

Use a lightweight CPU-local transcription runtime and keep network fetching separate from audio decoding. Do not assume FFmpeg exposes a redirect-limit option, even on recent Nix builds; the stream fetcher must pin the validated address, preserve TLS hostname verification, and reject redirects before the decoder sees bytes.

**Why:** The available FFmpeg 6.1 and 7.1 builds both rejected the expected redirect-limit option. Also, inaSpeechSegmenter resolved to a multi-gigabyte GPU dependency tree, which violates the bounded pilot footprint.

**How to apply:** For local speech work, verify executable options on the actual Replit build, use a CPU-only model, and reject dependency solutions that pull GPU runtimes or allow the decoder to follow network redirects.