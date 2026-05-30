---
name: jam-bot persona isolation & intent fast-path conventions
description: Two durable conventions for jam-bot's LLM layer — how to add behavioral modes without retoning the persona, and that every new intent needs a deterministic fast-path off the LLM hot path.
---

# Persona isolation
The owner's hard rule across feature work: ensure the bot stays she/her, but do
NOT rewrite or re-tone the existing persona, voice, or taste.

**How to apply:** add new behavioral modes (e.g. engaged-thread brevity-relax,
guided-tour narration, personalization, provoked burn-variation) as *layered
`opts` system blocks* appended in `askLLM` — leave the base `SYSTEM_PROMPT`
untouched. A mode that needs different verbosity/structure is fine as a
contextual block; rewriting the core voice/taste prompt is not.

**Why:** verbosity/length/engagement are separate axes from voice/taste/identity.
Layering keeps her core character stable while still allowing per-message
behavior, and keeps each feature's change auditable and removable.

# Intent fast-path off the LLM hot path
Every new intent (play, queue, skip, jam, tour, …) must be reachable through the
deterministic `fastPathIntent` regexes in `src/llm/openrouter.ts` BEFORE
`classifyIntent` falls back to the LLM. Parameter extraction that can be done
deterministically (e.g. tour length via `parseTourLength`, stop-tour via
`isStopTourRequest`) must also stay regex-based, not LLM-based.

**Why:** token efficiency is a hard constraint — common phrasings should never
pay for an LLM round-trip. A counted phrasing like "a 5-track tour of dub" once
slipped through because the tour regex didn't allow a count between the article
and "tour"; widen regexes to cover natural variants and test them with `fetch`
stubbed to throw so any accidental LLM call fails loudly.

**How to apply:** when adding/altering an intent, add the regex + a test in
`test/intent.test.ts` asserting the phrase resolves with no network call.
