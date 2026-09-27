---
name: JamBot OpenRouter JSON mode
description: Live compatibility behavior when OpenRouter catalog metadata omits JSON mode.
---

Do not infer that a model rejects `response_format` solely because OpenRouter's catalog omits it. A live Claude Sonnet 4 request with `response_format: {"type":"json_object"}` returned HTTP 200 and valid JSON, even though its catalog entry did not list that parameter. Keep a narrow retry for an explicit JSON-mode parameter rejection, and preserve local parsing and fail-closed validation.

**Why:** Catalog metadata and actual routing behavior differed in the live comparison; unconditional omission would hide a request mode that currently works, while unconditional assumption could break if the route changes.

**How to apply:** Probe the endpoint when compatibility matters. Retry without JSON mode only for a response that explicitly identifies that parameter as unsupported, and keep the retry within the same request deadline.