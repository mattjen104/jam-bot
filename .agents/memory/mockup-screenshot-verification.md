---
name: Mockup canvas screenshot verification
description: Why the external screenshot tool can show a working mockup as blank, and how to verify correctly
---

# Verifying mockup-sandbox components renders

The external screenshot tool (`screenshot type=external_url`) sometimes returns a fully BLANK/white image for a mockup-sandbox component that actually renders fine — it tends to choke on heavy CSS (backdrop-blur, large blurred glow blobs, mix-blend, animations), capturing before paint. A fresh `?cb=` cache-buster does NOT fix it.

**Why:** the external service renders headless and bails early on expensive paints; the real browser iframe on the canvas is unaffected.

**How to apply:** when external_url screenshot shows blank but the code looks valid (uses `min-h-screen`, no obvious throw), confirm with `screenshot type=app_preview artifact_dir_name=mockup-sandbox path=/preview/<folder>/<Component>` — it loads through the real proxy/browser and also returns the browser console log. If app_preview renders, the canvas iframe will too; do not waste cycles re-running the external screenshot.
