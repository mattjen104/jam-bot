---
name: Categorized pagination honesty
description: Honest empty and count labels when one ordered paginated stream is split into multiple UI categories.
---

When a single ordered result stream is paginated and each page is split into UI categories, a category with zero loaded rows is not necessarily empty until pagination is exhausted. While more pages remain, show counts as “loaded” and use “none loaded yet” rather than an authoritative empty claim.

**Why:** One category can occupy all newer pages while another category has valid older rows. Declaring the second category empty hides reachable evidence and misrepresents a partial page as the complete archive.

**How to apply:** Any view that categorizes a shared cursor-paginated stream must carry the page-completeness signal into each category’s count and empty state. Only the final page authorizes “none” or a total-looking count.