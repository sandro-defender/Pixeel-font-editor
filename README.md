# Pixeel — browser-based TTF font editor

Pixeel is a **fully client-side** font editor: create pixel fonts from scratch, import
existing `.ttf` files, edit glyphs, and export valid TrueType fonts — no backend, no
account, no paid APIs. **Uploaded fonts never leave your device.**

![stack](https://img.shields.io/badge/stack-React%20%2B%20TypeScript%20%2B%20Vite-blue)

## Feature overview

| Area | What you can do |
| --- | --- |
| Workspaces | Two independent fonts (Font A / Font B), side-by-side comparison, per-font export |
| Import | `.ttf` via file picker or drag & drop (`.otf`/CFF is converted to quadratic curves) |
| Glyph browser | Searchable grid with previews, Unicode values and names; create / duplicate / delete; re-assign Unicode with conflict validation; `.notdef` is always preserved; unmapped glyphs are visually distinct |
| Pixel editor | 8×8, 16×16, 32×32 or custom grids (≤128); pencil, eraser, fill, line, rectangle, selection; copy/cut/paste/move; shift, flip, rotate, invert, clear; undo/redo; zoom with grid lines; reference overlay for tracing; keyboard shortcuts; touch/pointer drawing; live actual-size + enlarged previews; baseline/ascent/descent/origin/advance guides; explicit crop/pad vs resample when resizing a grid |
| Outline editor | Imported vector glyphs keep their original outlines; select contours & points, move points, reverse or delete contours; edit advance width and side bearings; composite glyphs detected and preserved (or explicitly flattened); explicit "convert to pixels" with preview and loss-of-detail warning; revert to the original outline |
| Transfer A↔B | Copy one or many glyphs either direction; preserve source metrics or adapt; optional proportional scaling by units-per-em; baseline-aligned preview; collision handling (replace / skip / reassign); confirmation step; single undo step |
| Metadata & licensing | Full name-table editor (family, style, full/PostScript name, version, author, copyright, description, manufacturer, URLs); license editor with custom text or the **official SIL OFL 1.1 template** (editable holder + Reserved Font Names); `LICENSE.txt` export; license embedded in the exported name table; imported copyright/license preserved by default and never replaced silently |
| Preview | Live text preview rendered from the *currently edited* font (including unsaved changes), custom text/size/letter-spacing, samples for Latin, Georgian, numbers, punctuation |
| Persistence | Project files (`.pixeel.json`) with both fonts + metadata + grids + settings; automatic IndexedDB recovery snapshot restored after refresh |
| Export correctness | Real `glyf` TrueType outlines with correct cmap, metrics, names, bboxes and checksums; re-parse validation of every export; explicit report of preserved vs dropped tables |

## Technology & font engine

- **React + TypeScript + Vite**, all dependencies bundled (no runtime CDN).
- Font engine: **[fonteditor-core](https://github.com/ektx/fonteditor-core)** (MIT).
  It is one of the few browser-capable libraries that can both *read* and *write*
  genuine TrueType (`glyf`/`loca`) fonts. (opentype.js was evaluated and rejected:
  its writer emits CFF outlines only, which would not satisfy “download a valid
  `.ttf` with TrueType outlines”.)
- Pixel grids are converted to vector outlines by an edge-walking tracer that emits
  sharp, axis-aligned contours with correct counters (holes) and **no overlapping
  internal edges**; exported files contain real scalable outlines — *not* bitmap strikes.
- TTF export and preview rebuilds run in a **Web Worker** to keep the UI responsive.

## Getting started (local development)

```bash
npm install
npm run dev          # http://localhost:5173
```

### Tests

```bash
npm test             # 58 unit/integration tests (vitest)
npm run verify:pages # builds with a subpath base and serves it under /test-repo/
```

The test suite covers: create → draw → export → re-import; 8/16/32/custom grids;
holes and disconnected pixels; importing a real OFL-licensed font (Lato);
hinting/GPOS preservation; composite handling; transfers between different
units-per-em; collisions + undo/redo; metadata & OFL round trips; project
save/load and IndexedDB refresh recovery; GitHub Pages subpath serving.

## Building

```bash
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build locally
```

## Deploying to GitHub Pages (no GitHub Actions needed)

The app supports **project pages** (`https://<user>.github.io/<repo>/`).
The Vite `base` is resolved from `VITE_BASE_PATH`, or — for pages builds — from
the git origin repository name automatically.

**Option 1 — one command (uses the `gh-pages` dev dependency):**

```bash
npm run deploy
```

This runs `build:pages` (base = repository name from `git remote origin`) and
pushes `dist/` to the `gh-pages` branch. Then, in the repo settings, enable
Pages from the `gh-pages` branch (root).

**Option 2 — plain git, no extra tooling:**

```bash
VITE_BASE_PATH=/Pixeel-font-editor/ npm run build
git checkout --orphan gh-pages
git reset
cp -r dist/* .
git add -A
git commit -m "Deploy Pixeel build"
git push origin gh-pages
git checkout -    # back to your branch
```

**Option 3 — explicit base path** (any hosting subpath):

```bash
VITE_BASE_PATH=/my-subpath/ npm run build
```

## Supported formats & export behaviour

- **Import**: TrueType (`.ttf`, quadratic `glyf`) fully supported, including
  composite glyphs and hinting instructions. CFF-based OpenType (`.otf`) is
  imported by converting cubics to quadratics (curve detail may change). WOFF/WOFF2
  are rejected with an actionable message (convert to .ttf first).
- **Export**: always a genuine `.ttf` with tables `head hhea maxp OS/2 name cmap
  post glyf loca hmtx` plus, when present in the source and enabled:
  `cvt /fpgm/prep/gasp` (hinting) and `GPOS/kern/kerx` (kerning).
  Every export is **re-parsed and validated** (glyph count, unitsPerEm, sampled
  unicode→glyph→advance checks, name table, `.notdef`) and you see the report.
- **Unedited glyphs keep their original data**, including hinting instructions.
  Editing a glyph's outline invalidates its instructions (reported at export).
- **Composite glyphs** are preserved as composites while unedited; the editor
  offers an explicit *Flatten composite* action, and transfer flattens them safely.
- **Your uploaded file is never overwritten** — export downloads a new file.

## Export limitations (stated plainly)

fonteditor-core rewrites the core tables; it cannot carry through:

- `GSUB`/`GDEF`/shaping features (ligatures, alternates, mark placement),
- variable-font data (`fvar`, `gvar`, `HVAR`, …),
- color (`COLR`, `CBDT`, `sbix`, `SVG `), `DSIG` signatures, and similar.

If your source font contains these, the export dialog lists them explicitly and
labels the result a *simplified export*. Kerning (`GPOS`/`kern`/`kerx`) and
hinting are preserved when the toggles are on. Nothing is dropped silently —
check the export report before downloading.

## Licensing behaviour

- Imported fonts keep their copyright/license name records by default; the
  metadata dialog offers “Keep imported” as the default license mode.
- You can write custom license text or generate the official **SIL Open Font
  License 1.1** (full official text bundled in `src/core/oflText.ts`) with your
  copyright holder and Reserved Font Names, embed it in the font (name IDs 13/14),
  and download a standalone `LICENSE.txt`.
- Choosing a license does **not** establish ownership or a right to re-license
  someone else's font — the UI states this explicitly.

## Keyboard shortcuts (pixel editor)

`B` pencil · `E` eraser · `F` fill · `L` line · `R` rectangle · `M` select/move ·
arrows shift bitmap (or move selection) · `Ctrl+C/X/V` copy/cut/paste ·
`Ctrl+Z` / `Ctrl+Y` undo/redo · `I` invert · `Delete` clear · `G` grid lines ·
`+`/`−` zoom · `Esc` cancel selection · `Ctrl+S` save project.

## Known limitations

- One Unicode code point per glyph (fonts with multi-unicode glyphs keep the first mapping; noted on import).
- Vertical metrics editing is limited to ascent/descent/lineGap/unitsPerEm.
- Pixel-grid placement per glyph is linear (uniform cell size).
- Preview fonts are rebuilt asynchronously; very large fonts can take a couple of seconds.
- The glyph browser renders model previews (fast); the text preview uses the real rebuilt TTF.

## Repository layout

```
src/core/       font model, bitmap engine, contour tracer, TTF codec, licensing
src/state/      zustand store (undo/redo history), glyph mutators
src/services/   worker client, preview fonts, persistence, file actions
src/workers/    export/preview web worker
src/components/ UI (browser, editors, panels, dialogs)
src/render/     canvas/SVG glyph rendering
test/           vitest suite + OFL-licensed fixtures (see test/fixtures/README.md)
scripts/        GitHub Pages build verification
```

## License

MIT — see [LICENSE](LICENSE). Test font fixtures ship under their own OFL licenses.
