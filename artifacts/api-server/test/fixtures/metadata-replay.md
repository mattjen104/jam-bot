# Metadata replay corpus

This is a reviewed, sanitized replay corpus for station-owned metadata. It
contains public-shape examples only: artist names, song/show labels, and fake
`.example.test` artwork URLs. It does not contain credentials, cookies, access
tokens, private station data, or production identifiers.

## Precision bar

- Every fixture marked `accepted` must produce the reviewed artist/title pair
  and classify as `usable_pair`.
- Every fixture marked `rejected` must never be promoted as a music pair. A
  parser may return a pair for a source that does not know it is junk, but the
  shared classifier must classify it as `junk_metadata`.
- `unknown` covers empty, incomplete, malformed, filtered, or source-context
  values where there is not enough evidence to claim a music track. Unknown
  values must not count toward accepted music pairs.
- Parser errors are always regressions and must remain at zero.

The replay test prints accepted music pairs, rejected junk, incomplete/empty
observations, parser errors, extracted fields, and rejection reasons for each
source family. Add a fixture when a source adapter or metadata-quality rule
changes; do not use replay output to write production history.