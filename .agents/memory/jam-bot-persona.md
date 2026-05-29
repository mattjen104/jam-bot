---
name: jam-bot persona & escalation memory
description: How the jam-bot LLM voice works and why escalation uses an in-memory turn buffer instead of Slack history scopes.
---

# Persona
The bot's "ask a question" voice is a succinct, accurate music TEACHER for advanced
listeners — info-dense, no fluff/hype/opinion by default. When provoked (razzed,
cursed, insulted) she hits back HARDER, always through a musical lens (attacks their
TASTE/ear), and escalates: each successive jab → angrier, more verbose, sharper
musical similes. Never throws the first punch. Lives in `SYSTEM_PROMPT` (openrouter.ts).
`INTENT_SYSTEM` (intent classifier) is deliberately left neutral — do not give it personality.

# Why escalation uses an in-memory buffer (not Slack history)
True cross-turn escalation needs the model to see the running back-and-forth, but
the app intentionally avoids `channels:history`/`groups:history` scopes. Instead the
bot keeps an in-process rolling buffer (`convMemory` in bot.ts) of recent user+assistant
turns, keyed by channel for @mentions and `dm:<user>` for DMs, capped ~8 turns w/ 30-min TTL.
`askLLM(question, history)` splices these turns between the Jam-context system message
and the current user message.

**Why:** the bot already processes every @mention/DM as it happens, so it can record
turns itself — no new Slack scopes, deps, or keys required, and it deploys with zero prereqs.

**How to apply:** keep this buffer in-memory only (resets on restart, which is fine).
If @mention/DM restrictions are ever relaxed to many channels/users, add periodic key
eviction (empty keys are already deleted on read).

# Deferred parts of the same task
Gif read+post needs a Giphy/Tenor key + Slack `files` scope; general link-reading may
need an HTML-extract dep. These need user-supplied keys/scopes — not yet implemented.
