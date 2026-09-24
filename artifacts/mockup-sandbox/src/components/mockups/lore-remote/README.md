# Lore Remote extraction notes

This isolated prototype adapts the current Lore grammar rather than the amber reference mockup:

- `artifacts/lore/src/components/WorkflowAlbums.tsx`: square album tile, muted metadata, compact mono workflow actions, explicit Unresolved treatment.
- `artifacts/lore/src/components/StationMark.tsx`: station identity is a separate compact mark with a generated initials/radio fallback; it never substitutes album art.
- `artifacts/lore/src/index.css` (1473–1579) and `src/tokens/typography.css`: Void/grayscale dark palette, Nebula Sans interface roles and mono metadata treatment.

All records are local illustrative fixtures. No API, stream, database, account, or cross-device persistence is claimed. `LoreRemote.tsx` is standalone and intentionally does not import production Lore code.