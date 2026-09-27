---
name: JamBot passage citation route
description: Why JamBot uses locally verified quoted passages instead of provider-native web citation annotations.
---

For pasted links, keep the existing authorized OpenRouter chat route and quote-check passages from pages JamBot itself fetched. Do not treat OpenRouter's web-search `url_citation` annotations as passage citations for these pages: the documented annotations apply to search results the provider retrieves, not JamBot's already-fetched user links. Native document citation behavior through the existing chat route was not established by the published API documentation.

**Why:** Switching to provider search would change which pages are read and the trust/SSRF boundary, while a source URL annotation alone does not establish which exact page words support a claim. A local verbatim quote check is auditable and can fail closed without changing provider or credentials.

**How to apply:** If considering native citations later, verify the actual authorized route's request/response behavior with a bounded compatibility probe before replacing the local passage checks. Preserve user-link fetch limits and the shared response deadline.