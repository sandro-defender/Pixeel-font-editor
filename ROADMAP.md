# Pixeel — Roadmap

This document tracks the next evolution of Pixeel, organized as **Steps** (major themes) and **Slices** (small, shippable increments). Each slice is independently testable and documented. A Step is considered done when all its slices are merged and verified.

> Progress legend: ⬜ todo · 🟡 in progress · ✅ done

---

## Step 1 — UX & Accessibility Foundation ✅ DONE
Goal: Make daily editing faster, more keyboard-friendly, and more discoverable.

### Slice 1.1 — Command Palette (Ctrl+K) ✅ done
- **What:** Global command palette: fuzzy search over actions (new font, import, export TTF/ESPHome/project, save project, undo/redo, switch font A/B, open dialogs: info, help, pixel-grid conversion, LED settings, glyph designer, etc.), plus glyph jump (type a character or U+ code).
- **Acceptance:**
  - Ctrl/Cmd+K opens palette, Esc closes, Enter executes.
  - Works when no modal is open, doesn't steal input from text fields.
  - Lists at least 20 commands with icons and shortcuts.
  - Glyph jump filters browser and selects matching glyph.
  - Unit tests for command registry and fuzzy matching.

### Slice 1.2 — Metrics HUD & Enhanced Status ✅ done
- **What:** Live HUD overlay in pixel/outline editors showing advance width, LSB/RSB, bounding box, pixel count, and grid size. Enhanced status bar with zoom, cursor position, selection size.
- **Acceptance:**
  - HUD toggles with H, visible in both editors.
  - Status bar shows: cursor (x,y), selection (w×h), zoom, advance, bearings.
  - No layout shift, performant (memoized).
  - Tests for metrics calculations.

### Slice 1.3 — Contextual Help & Onboarding ✅ done
- **What:** First-run onboarding checklist, contextual tooltips, improved Help dialog with searchable shortcuts and video placeholders, empty-state improvements.
- **Acceptance:**
  - Onboarding stored in localStorage, dismissable.
  - Help dialog searchable, lists all shortcuts from Slice 1.1.
  - Tooltips on all primary toolbar buttons.
  - README updated.

**Step 1 Definition of Done:** Command palette, HUD, and onboarding all work, tests pass, README documents them.

---

## Step 2 — Pro Pixel Editing Tools
Goal: Bring Pixeel's pixel editor to parity with dedicated pixel art tools.

### Slice 2.1 — Symmetry & Mirroring
- **What:** Symmetry modes: horizontal, vertical, quad, radial. Toggle in pixel toolbar, live preview of mirrored strokes. Works with pencil, eraser, line, rect.
- **Acceptance:**
  - Symmetry state per glyph, persisted in project file.
  - Undo is one step per stroke (including mirrored pixels).
  - Visual symmetry guides.
  - Tests for symmetry math.

### Slice 2.2 — Tile Preview & Seamless Mode
- **What:** Tile preview panel showing glyph repeated 3×3, useful for pattern fonts and borders. Seamless mode highlights edge pixels that would tile.
- **Acceptance:**
  - Toggle in editor toolbar.
  - Live updates as you draw.
  - Works for both pixel and outline preview.
  - Tests.

### Slice 2.3 — Magic Wand & Improved Fill
- **What:** Magic wand selection (contiguous similar color), tolerance slider, contiguous fill option, fill preview. Improves existing fill tool.
- **Acceptance:**
  - Wand selects contiguous empty or filled region.
  - Fill respects selection if active, otherwise contiguous option.
  - Shift+click adds to selection, Alt+click subtracts.
  - Tests for flood fill and wand logic.

**Step 2 DoD:** All three tools work, no regression in existing tools, docs updated.

---

## Step 3 — Typography & Metrics Control
Goal: Full control over spacing and vertical metrics.

### Slice 3.1 — Visual Advance & Bearings Editor
- **What:** Drag handles in editor to adjust advance width, left and right side bearings visually. Numeric inputs remain. Snap to pixel grid option.
- **Acceptance:**
  - Dragging updates metrics live, undoable.
  - Works for both pixel and outline glyphs.
  - Guides show bearing lines.
  - Tests for metric updates.

### Slice 3.2 — Kerning Pairs Editor
- **What:** UI to view, add, edit, delete kerning pairs (GPOS/kern). Live preview in text preview panel with pair highlighting. Import existing kerning from font.
- **Acceptance:**
  - List of pairs with search, sorted by frequency.
  - Add pair by typing two characters or code points.
  - Edit value with slider and numeric input, live preview.
  - Export preserves kerning, re-import round-trips.
  - Tests.

### Slice 3.3 — Vertical Metrics Editor
- **What:** Dialog to edit ascent, descent, lineGap, typoAsc/Desc, winAsc/Desc, with visual preview of line box and baseline. Presets for common ratios.
- **Acceptance:**
  - Visual preview of metrics.
  - Validation (ascent >0, descent <0, etc.).
  - Undoable, persisted.
  - Tests.

**Step 3 DoD:** Metrics editing is visual and complete, kerning works end-to-end.

---

## Step 4 — Font Structure Expansion
Goal: Support complex font structures beyond one unicode per glyph.

### Slice 4.1 — Multi-Unicode Support
- **What:** Allow multiple Unicode code points per glyph (e.g., A and fullwidth A share same outline). UI to add/remove mappings, conflict detection, preserve on import/export.
- **Acceptance:**
  - Glyph browser shows all mappings.
  - Adding mapping checks for conflicts (with reassign option).
  - Export writes multiple cmap entries.
  - Import preserves first mapping previously but now all.
  - Tests for multi-unicode round-trip.

### Slice 4.2 — Composite Glyph Builder
- **What:** Visual builder for composite glyphs: add components, set offsets, scale, search base glyphs. Flatten preview, keep as composite on export.
- **Acceptance:**
  - Builder UI in outline editor.
  - Add/remove components, drag to position.
  - Preserves composites when unedited, builder edits as composite.
  - Tests.

**Step 4 DoD:** Multi-unicode and composites work, export validated.

---

## Step 5 — Import/Export Expansion
Goal: Support more formats for broader adoption.

### Slice 5.1 — WOFF/WOFF2 Import
- **What:** Import WOFF and WOFF2 by decompressing client-side (using wasm or JS decoder), then feeding to existing TTF path. Error messages for failures.
- **Acceptance:**
  - Drop .woff/.woff2 works.
  - No backend, fully client-side.
  - Tests with fixture.

### Slice 5.2 — BDF & Bitmap Font Import
- **What:** Import BDF (Glyph Bitmap Distribution Format) as pixel font, auto-detect cell size, preserve metrics.
- **Acceptance:**
  - .bdf file picker and drop.
  - Grid detection.
  - Tests.

**Step 5 DoD:** New formats import correctly, docs updated.

---

## Overall Definition of Done
- All steps merged to main.
- `npm test` green.
- `npm run build` and `npm run build:pages && npm run verify:pages` green.
- README and ROADMAP updated with progress.
- Each Step has its own PR with description, verification, and docs.

---

## Current Progress
- Step 1: ✅ done (Command palette, Metrics HUD, Onboarding & Help)
- Step 2: ⬜ not started
- Step 3: ⬜ not started
- Step 4: ⬜ not started
- Step 5: ⬜ not started
