---
name: Backfill candidate isolation
description: Keeping bounded background-job tests deterministic against a shared database.
---

Shared-DB tests of a bounded backfill batch should isolate the synthetic candidate they intend to verify. A fixed batch size does not guarantee selection when other eligible rows have a higher sort priority; do not mutate unrelated recordings just to empty the queue.

**Why:** Saved-only recordings are intentionally ordered after aired recordings. An otherwise valid fixture can wait behind an arbitrary backlog. An added candidate filter also failed to isolate the case until the existing OR predicate was grouped: SQL's AND precedence let the first OR arm bypass the filter.

**How to apply:** Preserve the production unfiltered batch behavior, but use a narrow optional filter for an integration case that must exercise a particular candidate. Use a grouped OR expression before conjoining any extra condition, and verify the resolver was called only for the fixture.