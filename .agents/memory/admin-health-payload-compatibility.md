---
name: Admin health payload compatibility
description: Backward-compatible rendering rules for operational health panels
---

Operational health panels should treat newly added response metrics as optional at the rendering boundary and display safe zero/null defaults when absent.

**Why:** Admin fixtures, cached responses, and briefly mixed-version deployments can contain the prior response shape; a missing operational metric must not crash the entire health page or hide unrelated diagnostics.

**How to apply:** When extending an admin health response, add defaults during component destructuring and keep the server response additive. Test both the new fields and an older payload shape.