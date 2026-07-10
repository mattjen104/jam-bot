---
name: Structured LLM extraction from scraped pages
description: How the station schedule scraper gets JSON out of an LLM safely, and the injectable-extractor seam it uses.
---

For turning messy first-party page text into structured data (e.g. a station's
weekly show grid), use an injectable extractor function (mirrors
`lib/song-enrichment/src/summarizer.ts`'s `askLLM` seam): a `configure*`
setter + a throw-if-unconfigured getter, wired at boot from a real provider.
Keep the parse/validate step pure and separate from the network call so it's
unit-testable without hitting the LLM.

**Why:** the model may wrap JSON in prose or a fenced code block, or return
ambiguous/partial entries. Never trust raw output — strip fences, `JSON.parse`
in a try/catch, then field-validate every entry (enum days, `HH:MM` regex,
length caps) and silently drop anything that doesn't fully match. An empty
array is a legitimate "no schedule" result, distinct from a parse failure
(`null`) — callers must be able to tell them apart so a failed scrape doesn't
wipe a previously-good schedule.

**How to apply:** api-server had no LLM client configured (only
`@workspace/song-enrichment`'s summarizer, which api-server explicitly leaves
unwired). Provisioning a new one meant setting up the Anthropic AI
integration via `setupReplitAIIntegrations` and copying
`lib/integrations-anthropic-ai` from the ai-integrations-anthropic skill
template (client only, skip the conversations/messages schema + routes if you
don't need chat history).

Two more things a code review caught on this pattern, worth getting right the
first time:
- A "successfully scraped, found nothing" result is not the same as "never
  scraped" — track a separate freshness timestamp (e.g. a `*ScrapedAt`
  column on the parent row) stamped on every successful attempt regardless of
  result size, and drive both re-scrape cadence and any public
  "last updated" field off that column, never off child-row presence/count.
  Otherwise a legitimately-empty result gets re-scraped every tick forever.
- Any integration client that throws at *module import time* if its env vars
  are missing (common pattern, e.g. `lib/integrations-anthropic-ai/src/client.ts`)
  must be imported lazily (dynamic `await import()` inside the wiring
  function, wrapped in try/catch) rather than as a top-level import — a
  top-level import crashes the whole server's boot sequence, not just the
  one feature.
- A "last successful scrape" timestamp is NOT enough to gate a small
  per-tick batch: a persistently-failing target (dead page, blocked, LLM
  error) never sets that timestamp, so it gets reselected on every tick
  forever and starves everything else in the batch. Track a second "last
  attempted" timestamp (success or failure) with its own, much shorter
  backoff, and require both cutoffs in the stale-target query.
- When following a same-page link the scraper discovered by
  keyword-matching (e.g. "schedule", "programming"), verify same-origin
  before fetching it — a keyword match says nothing about whose domain the
  link points to.
