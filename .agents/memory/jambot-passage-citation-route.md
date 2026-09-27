---
name: JamBot passage citation route
description: Why JamBot uses locally verified quoted passages instead of provider-native web citation annotations.
---

For pasted links, keep the existing authorized OpenRouter chat route and quote-check passages from pages JamBot itself fetched. Do not treat OpenRouter's web-search `url_citation` annotations as passage citations for these pages: the documented annotations apply to search results the provider retrieves, not JamBot's already-fetched user links. Native document citation behavior through the existing chat route was not established by the published API documentation.

**Why:** Switching to provider search would change which pages are read and the trust/SSRF boundary, while a source URL annotation alone does not establish which exact page words support a claim. A local verbatim quote check is auditable and can fail closed without changing provider or credentials.

**How to apply:** If considering native citations later, verify the actual authorized route's request/response behavior with a bounded compatibility probe before replacing the local passage checks. Preserve user-link fetch limits and the shared response deadline.

For PDF links, cite the physical page index alongside the exact extracted quote, not a printed page label: labels can be missing or inconsistent across editions. Image-only scans cannot provide quote-verified claims without a separately bounded OCR step; decline rather than infer text.

**Why:** A page number without locally checked words is not evidence, and silently treating a scanned page as readable would invite invented claims.

**How to apply:** Keep document extraction inside the same user-link trust boundary, and attach page provenance to individual passages so a cited quote cannot inherit a different passage's page.

Automatic web discovery is a separate trust boundary from following a pasted link. Send only positively recognized public music-fact questions to an external search provider; unknown and private-person questions must not be forwarded, including questions about someone else's listening activity.

**Why:** A blacklist of first-person pronouns misses third-person private listening history. A search-provider prompt asking it not to search such questions is too late: the question has already been disclosed.

**How to apply:** Gate discovery before making any provider request, and test both private third-person questions and public music-fact forms. Pasted links can still be fetched within JamBot's local link limits regardless of whether discovery is allowed.