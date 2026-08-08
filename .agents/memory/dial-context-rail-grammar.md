---
name: Dial context rail & sentence grammar
description: Where sentence link policy lives and the new link semantics for the tuned-context rail.
---

# Dial context rail & sentence grammar

- `src/dial/grammar.tsx` is the single import surface for radio sentence grammar: it owns the link policy and re-exports the pure builders from `dialViewHelpers`. New sentence rendering must route through it.
- Link semantics (deliberate change from the old convention): **dotted underline = navigate** (opens a lens), explicit small `+` (`.dial-addplus`) = add/seed, bright white no underline = yours (library/seeded). The old "dotted = addable" name-button pattern is dead — never reintroduce it in PopCrossingLine/SetQueueList.
- Song titles NEVER appear in radio sentences; station/show are structural attribution below the sentence. Enforced by `test/sentenceGrammar.test.tsx`.
- Many DialView tests `vi.mock` the ContextRail module path — keep the path and the `ContextRail` named export alive.
- Lens "open" routes come from the SELECTED entity's own identity (e.g. a set's own runId), never the currently-tuned show. Artist "sets containing X" reuses the existing archive artist-runs search and degrades to already-loaded dial data — no new endpoints, no infinite spinners.

**Why:** the link-affordance convention was flipped intentionally in the context-rail task; mixing conventions breaks the grammar tests and confuses users.
**How to apply:** any new dial/rail surface showing artist/DJ names must use grammar nodes (`artistNode`/`djNode`/`attributionLine`) and the `+` affordance for add.
