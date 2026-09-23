---
name: Station icon vs logo roles
description: Durable asset-role boundary for station identity marks and larger visual treatments.
---

Store station assets in two independent roles: a square station-specific icon may be a low-resolution favicon and is used for compact Dial/Library identity; the best official high-resolution logo may be rectangular and remains available for larger or backdrop treatments. Shared provider branding, including Spinitron-hosted logos, qualifies for neither role.

**Why:** One logo URL cannot satisfy both compact square identity and large visual treatments. Rejecting small favicons hides valid station identity, while forcing rectangular high-resolution art into compact squares produces poor results and repeated provider branding.

**How to apply:** Homepage enrichment should discover and persist both roles independently in one bounded crawl. Probe conventional root favicon/apple-touch paths only when declared candidates fail. A 404/410 robots file means no policy exists; explicit disallows and ambiguous retrieval failures still block. Compact station marks prefer the square icon. Larger surfaces may use the high-resolution logo without changing the icon contract.

Spinitron roster entries may have a provider page as a placeholder homepage; a scrape of that page cannot establish station-owned artwork. A verified official station homepage is necessary, but not sufficient: campus-hosted pages can advertise the parent university's square favicon. Reject institution/provider identities even when the image is technically valid, and use a station-owned rectangular wordmark only in a large treatment rather than forcing it into a square icon slot.

**Why:** Missing college marks included generic Spinitron branding, and two apparently valid square icons proved to be parent-university art rather than station identity.

**How to apply:** Resolve the station's official site first, then visually or semantically verify the selected icon/logo belongs to the station. Preserve operator-selected assets and respect robots blocks; a crisp initials fallback is better than falsely labeling a provider or university mark as the station.