---
name: Dial unified live feed
description: The Dial front door is one flat live-station feed (no Zone 1/2/3 split); ranking bands + infinite scroll replace zone labels and See-all toggles.
---

# Dial unified live feed

The former Zone 1 (crossing rows) / Zone 3 (also-on-air, DJ band + rest band)
split collapsed into ONE flat feed rendered by a single lane component. Ranking
— not zoning — expresses taste relevance:

- Bands: `reason` (crossing rungs 1–4, 6, 7) → `dj` (attributed r=5) → `rest`
  (unattributed r=0, pinned first). ▲ sort leads with reason; ▼ inverts band
  order. Rows carry `data-feed-band` on their wrapper; container is
  `#dial-feed-rows`.
- Every live station always renders with its current play. There is no "empty
  taste" wall as long as anything is on air.
- The "None of your artists have played today" nudge may render ONLY when zero
  live stations exist (settled crossings phase). Never next to visible rows —
  in a unified feed that message next to stations is a lie.
- Ghost/missed stations stay a separate subsection (offline playback, not live).

**Why:** zone caps + See-all/See-less toggles hid stations and produced a
misleading empty warning while live stations were visible.

**How to apply:**
- Long lists paginate via IntersectionObserver sentinel (infinite scroll).
  Progressive enhancement: when IntersectionObserver is absent (jsdom, old
  browsers) render the FULL list — jsdom component tests therefore always see
  every row and no sentinel; test pagination by stubbing IntersectionObserver.
- Zone sub-labels (`ZoneLabel`, "DJs on air", `.fdzone-lbl*`) and
  See-all/See-less (`.dial-show-more*`) are deleted — don't reintroduce them;
  the DJ credit inside the row is the attribution surface.
- Pagination reset on membership change uses render-phase state adjustment
  (`if (prev !== key) { setPrev(key); setVisible(INITIAL); }`), NOT a
  sync-setState effect — the react-compiler lint rule errors on the latter.
- Membership key must be order-insensitive (sorted slugs) so a live re-sort of
  the same stations doesn't collapse pagination.
