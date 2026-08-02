# Lore Typography System

Three semantic roles govern all font use across the classic UI (`index.css`)
and the WebPlayer (`wp.css`). Both CSS contexts import the canonical token
file at `tokens/typography.css` — font families are never re-declared
independently.

## The Three Roles

| Role | CSS token | Tailwind class | Face | Use for |
|------|-----------|----------------|------|---------|
| **Body** | `--lore-font-body` | `font-body` / `font-sans` | Inter / system-ui | UI copy, descriptions, body paragraphs, button labels |
| **Display** | `--lore-font-display` | `font-display` / `font-serif` | Archivo Narrow / system-ui | Station names, track titles, page headings, chips, nav labels, callouts |
| **Mono** | `--lore-font-mono` | `font-mono` | IBM Plex Mono / Menlo | Metadata, timestamps, counts, resolving state, technical strings |

> `font-serif` is a backward-compatible alias for `font-display` (both resolve
> to Archivo Narrow). New code should use `font-display` explicitly.

## Why Fraunces and Newsreader Are Not Loaded Globally

Both faces were loaded unconditionally in the v1 system, creating two
divergent design languages and unnecessary font-load cost on every page.

- **Fraunces** (variable-weight expressive serif) was used for headings and
  track titles — roles that Archivo Narrow fills with tighter optical weight
  and better legibility at small sizes. The visual identity is preserved
  without a separate download.

- **Newsreader** (editorial serif for long-form reading) has no long-form
  reading surfaces in the current product. It remains available for deliberate
  editorial contexts (see below).

## Scoped Editorial Face

If a future surface genuinely needs a reading serif (e.g. a long editorial
blurb or a printed liner-note style layout), wrap the container with the
`.reading-context` class. This activates `--lore-font-editorial` (Newsreader)
for that subtree only:

```html
<div class="reading-context">
  <!-- Newsreader active here via --lore-font-editorial -->
</div>
```

Do **not** introduce a fourth global font family. If you feel the urge to add
one, first check whether `display` (Archivo Narrow at a heavier weight) or a
CSS `font-style: italic` variant of an existing role solves the problem.

## Adding a New Font Callsite

1. Pick the closest semantic role from the table above.
2. Use the Tailwind utility class (`font-body`, `font-display`, `font-mono`).
3. Never write `fontFamily: "..."` as an inline style or `font-['FontName']`
   as a hardcoded Tailwind arbitrary value.
4. If none of the three roles fit, discuss before adding a new token.
