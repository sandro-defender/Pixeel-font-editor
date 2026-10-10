# Pixeel — browser-based TTF font editor

**🌐 Online tool: [https://sandro-defender.github.io/Pixeel-font-editor/](https://sandro-defender.github.io/Pixeel-font-editor/)**

Pixeel is a **fully client-side** font editor: create pixel fonts from scratch, import
existing `.ttf` files, edit glyphs, and export valid TrueType fonts — no backend, no
account, no paid APIs. **Uploaded fonts never leave your device.**

![stack](https://img.shields.io/badge/stack-React%20%2B%20TypeScript%20%2B%20Vite-blue)

## Feature overview

| Area | What you can do |
| --- | --- |
| Workspaces | Two independent fonts (Font A / Font B), side-by-side comparison, per-font export |
| Import | `.ttf` via file picker or drag & drop (`.otf`/CFF is converted to quadratic curves); **pixel fonts are detected** — the importer finds the cell size at which every outline lands on the lattice and offers a lossless conversion |
| Glyph browser | Searchable grid with previews, Unicode values and names; create / duplicate / delete; re-assign Unicode with conflict validation; `.notdef` is always preserved; unmapped glyphs are visually distinct; add the 33 modern Mkhedruli starter glyphs or all 172 assigned Georgian letters across Mkhedruli, Mtavruli, Asomtavruli and Nuskhuri |
| Pixel editor | 8×8, 16×16, 32×32 or custom grids (≤128); pencil, eraser, fill, **magic wand (W)**, line, rectangle, selection; **symmetry modes** (H/V/quad/radial) with guides; **tile preview 3×3 + seamless**; copy/cut/paste/move; shift, flip, rotate, invert, clear; undo/redo; zoom with grid lines; **keyboard cursor** (arrows move it, Space paints, Shift+Space erases, T toggles); **hover coordinate readout** and **index rulers**; **right-drag erases**; reference overlay for tracing; touch/pointer drawing; live actual-size + enlarged previews; baseline/ascent/descent/origin/advance guides; explicit crop/pad vs resample when resizing a grid; text-art and LED column-byte entry (*Pixel code…*); **local glyph designer** with reference fonts, Georgian character sets, and width/height/weight/slant/position controls |
| Reference fonts | Drop TTF/OTF examples into `public/fonts/` and index them with `npm run fonts:catalog` (production builds index automatically), or load a font file directly in the glyph designer; sample any supported letter/number and place the styled bitmap into the selected pixel glyph. Everything stays in the browser. |
| LED matrix fonts | Optional exact-pixel mode per font: fixed grid height, one integer unit size per lit pixel, glyph origins on whole-pixel boundaries, advance = (width + spacing) × pixel size; an LED dot preview; *Snap to LED grid* for vector glyphs; export checks that verify every glyph (errors for off-grid data, warnings for advances) |
| Outline editor | Imported vector glyphs keep their original outlines; select contours & points, move points, reverse or delete contours; edit advance width and side bearings; composite glyphs detected and preserved (or explicitly flattened); **convert to pixels** for one glyph or the whole font, on one shared grid (see [Converting a font to pixels](#converting-a-font-to-pixels)); revert to the original outline |
| Transfer A↔B | **Copy** or **Move** one or many glyphs either direction (Move removes them from the source after copying; `.notdef` is never removed; skipped glyphs stay put); drag glyph cards onto the A/B tabs; preserve source metrics or adapt; optional proportional scaling by units-per-em; baseline-aligned preview; collision handling (replace / skip / reassign); confirmation step; one undo step reverts both fonts for a move |
| Metadata & licensing | Full name-table editor (family, style, full/PostScript name, **version**, **author**, copyright, description, manufacturer, URLs); license editor with custom text or the **official SIL OFL 1.1 template** (editable holder + Reserved Font Names); `LICENSE.txt` export; license embedded in the exported name table; imported copyright/license preserved by default and never replaced silently |
| New-font wizard | Name, style, **author**, **version** and **license are created automatically** — pick *SIL OFL 1.1* and the full license text, copyright line and Reserved Font Name are generated for you at creation time |
| ESPHome export | One click downloads a **ZIP with everything ESPHome needs** — see [Using fonts with ESPHome](#using-fonts-with-esphome) |
| Preview | Live text preview rendered from the *currently edited* font (including unsaved changes), custom text/size/letter-spacing, samples for Latin, Georgian, numbers, punctuation |
| Persistence | Project files (`.pixeel.json`) with both fonts + metadata + grids + settings; automatic IndexedDB recovery snapshot restored after refresh |
| Export correctness | Real `glyf` TrueType outlines with correct cmap, metrics, names, bboxes and checksums; re-parse validation of every export; explicit report of preserved vs dropped tables |
| Version display | The app version and the **name, version and author of the selected font** are always visible in the header and status bar |
| Command palette | **Ctrl/Cmd+K** fuzzy search over 20+ actions (new font, export, dialogs, undo/redo, switch font, theme, grid toggle, etc.) + **glyph jump** by character or U+ code (e.g. `A`, `U+10D0`) |
| Metrics HUD | Toggle with **H** — overlay shows advance width, LSB/RSB, bbox, pixel count, grid size, cursor, selection, zoom; enhanced status bar shows cursor (x,y), selection (w×h), advance, bearings, zoom, grid state |
| Onboarding & help | First-run **onboarding checklist** (stored in localStorage, dismissable); **searchable help dialog** with all shortcuts grouped by category; tooltips on every primary toolbar button |
| Symmetry & mirroring | **Per-glyph symmetry**: none / horizontal / vertical / quad / radial; live mirrored strokes for pencil/eraser/line/rect; visual guides; undo is one step; persisted in project |
| Tile preview | **3×3 tiled preview** of current glyph, live updates; **seamless mode** highlights edge pixels; toggle in toolbar |
| Magic wand & fill | **Wand tool (W)** selects contiguous empty/filled region (BFS 4-dir); **Shift+click adds, Alt+click subtracts**; fill respects active selection; flood fill toggle |
| Advance & bearings editor | **Drag handles** for the advance width, left and right side bearings in both the pixel editor (ruler band) and the outline editor (origin and advance lines); live while dragging, **one undo step per drag**; optional **snap to the pixel grid** (or a vector step); numeric inputs stay in the Metrics panel; bearing guides drawn in the editors |
| Kerning pairs | **Kerning dialog** (Font menu, Metrics panel, preview panel, command palette): search the list (sorted by how common the pair is), add a pair by typing two characters or code points (`A`, `U+0056`, `86`), edit with a slider **and** a numeric field, delete; pairs are imported from the font's `kern` / `GPOS` tables; the preview panel applies kerning live and can **highlight kerned pairs** |
| Vertical metrics | **Vertical metrics dialog** (Font menu, command palette): ascent, descent, line gap, OS/2 typo ascender/descender/line gap, win ascent/descent and *Use typo metrics*; live **line-box preview** (hhea blue, typo green, win orange, baseline, line gap); **presets** (tight, pixel, Arial-, Roboto-, Times-like, airy); sync typo/win to hhea; validation (ascent > 0, descent ≤ 0, whole numbers, 16-bit ranges) with clipping and platform-mismatch warnings; one undo step; saved in project files; imported OS/2 values are preserved on export |

## Using fonts with ESPHome

*Export → **ESPHome package .zip*** builds a ready-to-flash archive, so you never
have to hand-write the `font:` block or guess which characters your font defines.
The ZIP contains:

```
MyFont-Regular.ttf          the compiled TrueType font
LICENSE.txt                 the license your font carries
README.md                   wiring instructions
esphome/MyFont-Regular.yaml a ready-to-paste font: block
esphome/glyphs.txt          every glyph in your font, as plain text
```

The generated YAML is complete and valid:

```yaml
font:
  - file: "MyFont-Regular.ttf"
    id: myfont_regular
    size: 16
    # Only the glyphs that are defined in your font are listed below, keeping
    # the firmware binary small. Edit this list to add/remove characters.
    glyphs: " !\"#$%&'()*+,-./0123456789:;<=>?@ABC…"
```

To use it:

1. Copy `MyFont-Regular.ttf` and the `esphome/` folder next to your node's `.yaml`.
2. Paste the `font:` block into your config — or include the glyph list instead of
   inlining it:
   ```yaml
   font:
     - file: "MyFont-Regular.ttf"
       id: myfont_regular
       size: 16
       glyphs: !include esphome/glyphs.txt
   ```
3. Draw with it from a display lambda:
   ```cpp
   it.print(0, 0, id(myfont_regular), "Hello!");
   ```
4. Compile and flash.

Notes:

- `size:` defaults to **16**; for an LED-matrix font the export uses the matrix
  height. Change it freely — ESPHome rasterizes at whatever size you ask for.
- Only the glyphs your font actually defines are listed (sorted by code point,
  `.notdef` excluded). Trimming that list is the main lever on firmware size.
- Quotes and backslashes in the glyph set are escaped, so the YAML always parses.
- `LICENSE.txt` is included — respect the font's license when you redistribute.

## Using the local glyph designer

Open a pixel glyph and choose **Glyph designer…** from the pixel toolbar. Pick a
reference font and a source character, try the width, height, stroke-weight,
slant and vertical-position sliders, then choose **Place in pixel window**. The
result replaces the selected glyph's pixels as one undoable edit, so you can
continue refining it directly on the canvas.

The designer includes a system-font fallback and an **Add font file…** picker
for a one-session TTF/OTF reference. To keep your own reference fonts in the
project, copy them into `public/fonts/` (subfolders work), run
`npm run fonts:catalog`, then refresh Pixeel. Normal production builds scan and
index that folder automatically. See [`public/fonts/README.md`](public/fonts/README.md).
Catalog fonts are served from the same site as the app; uploaded reference files
are read from your device. No font or glyph is sent to an AI service or remote API.

Georgian names/search cover Mkhedruli, Mtavruli, Asomtavruli and Nuskhuri. The
**ქ+** action in the glyph browser adds all assigned Georgian letter code
points; **Aa+** stays a smaller starter set with the modern 33-letter Mkhedruli
alphabet.

## Converting a font to pixels

*Convert to pixel grid…* (Font menu, or the editor toolbar for a single glyph) rebuilds
vector outlines as editable pixels. Two things make a converted font usable:

1. **One grid for the whole font.** Every glyph is rasterized with the *same* cell size
   and the *same* baseline phase, so an `i` and a `g` keep the same pixel size and still
   sit on one line. (Sizing each glyph's frame from its own ink gave every glyph a
   different cell size *and* baseline row — converted text no longer lined up.)
2. **Exact coverage, majority threshold.** The ink fraction of every cell is computed
   exactly (the outline is clipped against the cell rectangle), and a cell lights at 50 %
   coverage — a box filter, so stroke weight survives the downsample. Probe sampling is
   gone: it let a 20 %-covered cell light while a 60 %-covered one stayed dark.

**Pixel-font detection.** For a "true" pixel font there is one cell size at which every
outline coordinate lands on the lattice and every cell is either completely empty or
completely full — no intermediate grays. The converter searches the coordinate lattice
(GCD of the outline differences, plus every "N rows tall" size), then verifies the
candidate by measuring how much of the ink is *not* cleanly resolved. When a font has
such a size (grayness ≈ 0) the conversion at that size is **lossless** and the dialog
says so; importing a pixel font also offers it straight away. Anything else is reported
as a downsample and you pick the grid height.

Glyphs keep their original outline in `sourceContours`, so *Revert to original outline*
still works, and advance widths are snapped to whole pixels by default — otherwise text
set in the converted font drifts off the lattice and the crisp rendering is lost again.

## Technology & font engine

- **React + TypeScript + Vite**, with **MUI (Material UI)** for layout and controls (light/dark theme), all dependencies bundled (no runtime CDN).
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
npm test             # 262 unit/integration tests (vitest)
npm run verify:pages # builds with a subpath base and serves it under /test-repo/
```

The test suite covers: create → draw → export → re-import; 8/16/32/custom grids;
holes and disconnected pixels; importing a real OFL-licensed font (Lato);
hinting/GPOS preservation; composite handling; transfers between different
units-per-em; collisions + undo/redo; metadata & OFL round trips; project
save/load and IndexedDB refresh recovery; GitHub Pages subpath serving;
LED matrix validation (exact pixels, advance warnings, height locking), text-art
and column-byte round trips, LED conform on transfer, move transfers with one
linked undo/redo and collision-skipped glyphs, and the pixel editor's keyboard
cursor (one undo per Ctrl+Z).

Typography coverage: bearing/advance drag math and snapping, the drag handles in
both editors (one undo per drag), kerning parse/write for `kern` and `GPOS`
(Lato), kerning edit/import/export round trips and the dialog, vertical-metrics
validation, presets, OS/2 export/re-import (Lato keeps its own values) and the
dialog.

New-font identity is covered too: the derived names (full / PostScript / unique)
follow the family and style instead of keeping placeholders, and author, version
and a generated OFL license flow from the create dialog into the exported name
table. The ESPHome package is verified end to end — the ZIP's file list, the
embedded TTF, the `font:` block, the glyph set (including YAML escaping of quotes
and backslashes), and the license/README that ship with it.

Vector→pixel conversion has its own coverage: thin marks that sit off the
baseline (underscores, minus signs, hairline stems) must never rasterize to an
empty grid, the frame is derived from the glyph's own ink rather than the line
metrics, and converting a whole font to an LED matrix maps the design onto the
matrix (no clipped letter tops, no vanished glyphs) — including re-snapping a
single glyph afterwards and copying glyphs into an LED font.

## Building

```bash
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build locally
```

## Deploying to GitHub Pages

The app supports **project pages** (`https://<user>.github.io/<repo>/`).
The Vite `base` is resolved from `VITE_BASE_PATH`, or — for pages builds — from
the git origin repository name automatically.

### Automatic deployment with GitHub Actions

The workflow in `.github/workflows/deploy-pages.yml` runs on every push to `main`
and can also be started manually from the repository's **Actions** tab. It
installs the locked dependencies, runs the tests and Pages-path verification,
builds the site, then deploys `dist/` to GitHub Pages. It deploys through the
GitHub Pages deployment service; it does not need to commit generated files to
a `gh-pages` branch.

One-time repository setup: open **Settings → Pages** and set **Build and
deployment → Source** to **GitHub Actions**. After a successful workflow run,
the published site is available at `https://<user>.github.io/<repo>/`.

### Manual deployment (optional)

The commands below publish through the `gh-pages` branch instead of the
Actions deployment. If you switch to this method, change **Settings → Pages →
Build and deployment → Source** to **Deploy from a branch**, then select
`gh-pages` and `/ (root)`.

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
- **Kerning**: an unedited font's own `kern`/`GPOS` bytes pass through untouched.
  After you edit pairs, the kerning is exported as a classic `kern` table (a
  `GPOS`/`kerx` table in the source is replaced, and the export report says so);
  pairs with value 0 are not written. Class-based `GPOS` kerning in big fonts is
  expanded on import up to 25 000 pairs (Latin first); editing a truncated font
  rewrites kerning from only the loaded pairs and the dialog warns about it.
- **Vertical metrics**: hhea, OS/2 typo, OS/2 win values and the *Use typo
  metrics* flag (fsSelection bit 7) are written from the editor; imported fonts keep
  their own OS/2 values.
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

Arrow keys move the **keyboard cursor** (the outlined cell). With a selection they nudge
it instead. **Shift+arrows** shift the whole bitmap by one pixel.

| Key | Action |
| --- | --- |
| `Ctrl/Cmd+K` | Open **command palette** — fuzzy search actions + glyph jump (type `A` or `U+10D0`) |
| Arrow keys | Move the cursor (nudge the selection when one is active) |
| Shift + arrows | Shift the bitmap one pixel |
| `Space` / `Enter` | Act at the cursor with the current tool |
| `Shift` + `Space` | Erase at the cursor |
| `T` | Toggle the pixel under the cursor |
| `B`/`P` pencil · `E` eraser · `F` fill · `L` line · `R` rectangle · `M`/`S` select | Tools |
| `G` | Toggle grid lines |
| `H` | Toggle **metrics HUD** overlay (advance, bearings, bbox, pixel count, cursor, selection) |
| `I` invert · `+` / `−` zoom | Edit / view |
| `Ctrl+A` | Select all |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | Copy / cut / paste (paste lands at the cursor) |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo (one step per edit) |
| `Ctrl+S` | Save project |
| `Esc` | Place a floating selection, or cancel an in-progress stroke |
| `Delete` / `Backspace` | Delete a floating selection, or clear the grid |

Mouse: the left button paints with the current tool; **right-drag erases**. Hovering
shows the pixel's column (from the left) and row (from the top) in the status line.
Rulers number the columns and rows.

Behaviour changed in this release: arrow keys no longer shift the bitmap by default.
Use **Shift+arrows** for that.

## Known limitations

- One Unicode code point per glyph (fonts with multi-unicode glyphs keep the first mapping; noted on import).
- Units per em is read-only in the vertical metrics dialog. LED matrix fonts derive ascent/descent/line gap from the matrix, so those three are read-only there (typo and win values stay editable).
- Kerning is pair-based: class kerning, contextual positioning and other GPOS features are not editable.
- LED matrix mode fixes the grid height for every glyph. Switching a font into LED mode rasterizes vector glyphs onto the grid, so their outlines are replaced by pixels (undo reverts this).
- Transfers keep each standard pixel glyph's own grid size. Only an LED destination resamples glyphs onto its grid. Resampling uses nearest-neighbour, which can alias.
- Pixel-grid placement per glyph is linear (uniform cell size).
- Preview fonts are rebuilt asynchronously; very large fonts can take a couple of seconds.
- The glyph browser renders model previews (fast); the text preview uses the real rebuilt TTF.

## Repository layout

```
src/core/       font model, bitmap engine, contour tracer, pixel-grid/rasterizer, TTF codec, licensing
src/state/      zustand store (undo/redo history), glyph mutators
src/services/   worker client, preview fonts, persistence, file actions, ESPHome package export
src/workers/    export/preview web worker
src/components/ UI: MUI top bar, glyph browser, editors, side panels, dialogs
src/render/     canvas/SVG glyph rendering (cached bitmap layers)
src/theme/      MUI theme (light/dark palette)
test/           vitest suite + OFL-licensed fixtures (see test/fixtures/README.md)
scripts/        GitHub Pages build verification
```

## License

MIT — see [LICENSE](LICENSE). Test font fixtures ship under their own OFL licenses.
