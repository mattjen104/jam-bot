---
name: Library collection vs album workflows
description: Defines what belongs in the aggregate Library and how album workflow views relate to it.
---

The Lore moon opens the aggregate Library. Library contains individually kept tracks plus complete albums only after they are filed to Shelf. It can be viewed as Albums, Songs, or Artists.

The Albums lens is an index of canonical Lore album pages. Merge kept-track album identity with filed Shelf identity by release-group MBID, show each album once, and link to `/album/:releaseGroupMbid`; that page owns sharing, service links, playback, credits, track order, and provenance.

Inbox, Rotation, Passed, and Unresolved are workflow views outside the aggregate Library. An Inbox album is not owned yet. Rotation is still being evaluated and is not saved to Library. Filing is the action that admits the complete album.

The moon starts the permanent menu row, followed by Radio, Inbox, Rotation, Shelf, Passed, and Unresolved. Discover, Press, and Merch stay hidden.

**Why:** The user distinguishes intentional Library ownership from evaluation. Keeps are owned at track level; an album becomes owned only when filed. Workflow state must not accidentally promote Inbox or Rotation albums into Library.

**How to apply:** Keep workflow pages album-only. Put Songs/Albums/Artists grouping and artist search/add controls only in the moon Library section. Aggregate kept tracks with filed Shelf albums, excluding Inbox, Rotation, Passed, and Unresolved. Never embed workflow mutation controls or duplicate the canonical album-page feature set in the Albums lens.