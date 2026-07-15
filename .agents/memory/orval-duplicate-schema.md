---
name: Orval duplicate schema detection
description: Python yaml.safe_load silently picks the last duplicate key (so YAML appears valid), but orval fails with "Failed to resolve input" on duplicate schema names.
---

When adding new component schemas to openapi.yaml, if a schema name already exists (e.g. `ArtistCatalogue`), Python's `yaml.safe_load` will silently use the last definition — so the file passes YAML syntax validation but orval refuses to process it with: `"Failed to resolve input: Please provide a valid string value or pass a loader to process the input"`.

**Why:** orval uses a stricter OpenAPI parser that validates the spec semantics, not just YAML syntax. Duplicate keys in the `components/schemas` map are illegal in OpenAPI 3.0.

**How to apply:** Before adding any new component schema to openapi.yaml, grep for its name first:
```bash
grep -n "SchemaName:" lib/api-spec/openapi.yaml
```
If it already exists, reference the existing schema instead of defining a new one. Also run `python3 -c "import yaml; yaml.safe_load(open('openapi.yaml'))"` for syntax — but trust the orval output, not Python's silence, for semantic validity.
