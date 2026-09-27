---
name: JamBot factual evidence boundary
description: Durable rules for separating classification, canonical evidence, and user-visible factual answers.
---

JamBot classification may choose a route or judge sufficiency, but it never supplies facts. Factual prose can use only successfully retrieved user links or published Lore claims tied to a strong canonical identity. Citation IDs are rendered back to the exact retrieved source URL; unknown IDs, model-authored links, weak identity, malformed output, and missing evidence all produce a short limitation instead.

**Why:** Conversational context, title/artist guesses, and model confidence can sound authoritative without provenance. Keeping those outside the evidence ledger prevents unsupported claims and prevents weak matches from contaminating Lore.

**How to apply:** Keep playback/cards/social replies on their deterministic or existing conversational paths. For factual answers, resolve exact identifiers first, reuse Lore claims, invoke canonical enrichment only through a strong-ID boundary, provide bounded excerpts to generation, and validate citations after generation.

For guided tours, a Spotify album date describes that particular edition, not the recording's original year. Do not turn an edition date into a claim about when the song first came out, and never let an uncited model-written intro or tidbit assert chart positions or personnel.

**Why:** A plausible chart ranking was wrong, and a plausible era pick fell outside the requested decade; neither track search nor prompting the model to "stay factual" verifies history.

**How to apply:** Keep dated tours conservative when release evidence is missing or ambiguous. Phrase available dates as edition dates; require independent recording-level evidence before claiming an original release year.