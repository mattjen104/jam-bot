---
name: Blog picker identity & tolerance
description: How blog pickers are matched, merged, and kept from auto-demotion
---
Rule: a blog picker's identity is its `sourceRef->>'feedUrl'`, not a slugified name.
**Why:** ingestBlogFeed used to upsert by slugify(name); any seeded handle that differed from the slug ("guardian-music" vs "the-guardian-music") forked a duplicate picker on every poll. Fixed by selecting the existing picker by feedUrl (active DESC, id ASC) before upserting.
**How to apply:** any new blog ingest path must look up by feedUrl first. Duplicate aliases are folded by mergeDuplicateBlogPickers() at boot (repoint picks/shows/list_sources/blog_list_candidates with collision dedupe, then delete alias).
Also: `sourceRef.tolerant = true` marks known-flaky feeds — health is recorded but the poller never auto-demotes them. Seeded pickers demoted earlier get re-activated at boot with `health: null` (streak must reset or one new failure instantly re-demotes).
Review-blurb headlines ("Artist: Album review – blurb", "…REVIEWS…: BAND – ALBUM") must be skipped when the artist side of a dash split contains "review(s)" — they otherwise create junk picks.
