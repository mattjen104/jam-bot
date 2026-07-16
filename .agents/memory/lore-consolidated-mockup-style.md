---
name: Lore consolidated mockup style
description: The approved visual language for lore-consolidated canvas mockups and how they are built in the sandbox.
---

The user approved the verbatim chat-session design (warm dark tokens: surface #262521, accent #8b7cf6 violet, success #8fdb69, Tabler icons webfont, inline styles, 900px wrap) over the earlier amber/green phone-layout mockups.

**Why:** user attached the exact HTML export and said "More like this"; earlier hand-styled versions were replaced.

**How to apply:** new lore mockups should reuse the `.lore-v2` token block in `lore-consolidated-v2/_group.css`. Verbatim HTML mockups are rendered via `dangerouslySetInnerHTML` of static trusted strings — acceptable only for repo-authored constants, never dynamic content. Scope all tokens/base rules under a group class (not :root) so groups coexist in the shared sandbox. The header comment in the attached file also documents a "Lore brand alternative" palette (near-black purple #12101a / lime #c7f53f) if the user wants brand colors later.
