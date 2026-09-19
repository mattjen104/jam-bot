---
name: Published collection withdrawal
description: Durable link and ownership policy for public Lore collections.
---

Withdrawing a public collection must retain its database row and permanently reserve its slug. Public collection, JSPF, and player reads return a 410 tombstone while withdrawn. Updating the collection as its owner clears the withdrawal and republishes the same link.

**Why:** Old shared links must not silently point to a different curator's collection, and curators need to correct or restore a publication without changing its URL.

**How to apply:** Treat collection deletion as a soft withdrawal. Never recycle collection slugs, and require the original owner for updates, withdrawal, and republication.