/** File-level actions shared between the top bar, drag & drop and dialogs. */
import { FONT_FILE_LABEL, FONT_FILE_RE } from '../core/fontFiles';
import { useStore } from '../state/store';
import type { FontDoc, Slot } from '../core/types';
import { resolveGlyphContours } from '../core/fontCodec';
import { importAnyFont } from '../core/importAny';
import { detectFontPixelGrid } from '../core/pixelGrid';
import { dropSource, downloadProjectFile, parseProjectFile, projectFileName, registerImportedSource } from './persistence';
import { releasePreview } from './previewFont';
import { fetchMatrixClockFontBytes, type MatrixClockOnlineFont } from './matrixClockFonts';

/**
 * Detect the native pixel grid of an imported font, if it has one.
 * Never throws: a failed detection just means "not a pixel font".
 */
function detectImportedPixelGrid(doc: FontDoc) {
  try {
    return detectFontPixelGrid(doc, (g) => resolveGlyphContours(g, doc.glyphs));
  } catch {
    return null;
  }
}

/**
 * Ask before anything replaces unsaved work. Resolves true when it is safe to
 * continue (nothing unsaved, or the user agreed to discard it).
 */
export async function confirmDiscardChanges(slots: Slot[], action: string): Promise<boolean> {
  const { dirty, askConfirm } = useStore.getState();
  const dirtySlots = slots.filter((slot) => dirty[slot]);
  if (dirtySlots.length === 0) return true;
  const names = dirtySlots.map((slot) => `Font ${slot}`).join(' and ');
  const plural = dirtySlots.length > 1;
  return askConfirm({
    title: 'Discard unsaved changes?',
    message: `${names} ${plural ? 'have' : 'has'} unsaved changes. ${action} will discard ${plural ? 'them' : 'it'}. Save the project first (Ctrl+S) to keep ${plural ? 'them' : 'it'}.`,
    confirmLabel: 'Discard changes',
    danger: true,
  });
}

/**
 * Release source TTF data that no longer belongs to any font after a swap.
 * `before`/`after` are the two workspaces around the change.
 */
export function releaseSourcesNotIn(before: Array<FontDoc | null>, after: Array<FontDoc | null>): void {
  const keep = new Set(after.map((f) => f?.sourceRef).filter((r): r is string => !!r));
  for (const font of before) {
    if (font?.sourceRef && !keep.has(font.sourceRef)) dropSource(font.sourceRef);
  }
}

/** Save the current workspaces as a downloadable project file. */
export function saveProjectFile(): void {
  const s = useStore.getState();
  if (!s.fonts.A && !s.fonts.B) {
    s.toast('warning', 'Nothing to save yet — create or open a font first.');
    return;
  }
  const name = downloadProjectFile({ fonts: s.fonts, active: s.active, theme: s.theme }, projectFileName(s.fonts));
  s.markProjectSaved(Date.now());
  s.toast('success', `Project saved as ${name}. Both fonts, metadata, pixel grids and settings are included.`);
}

/**
 * Parse already-loaded font bytes and put the font into a workspace slot.
 * The caller is responsible for the discard-unsaved-changes confirmation;
 * resolves true when the font was loaded.
 */
async function loadFontBuffer(slot: Slot, buffer: ArrayBuffer, fileName: string, origin?: string): Promise<boolean> {
  const store = useStore.getState();
  store.setBusy(`Reading ${fileName}…`);
  try {
    const { doc, sourceTtf, warnings, bdf } = await importAnyFont(buffer, fileName);
    const ref = sourceTtf ? registerImportedSource(sourceTtf) : null; // BDF has no outline source to preserve
    const before = [useStore.getState().fonts.A, useStore.getState().fonts.B];
    const imported = { ...doc, sourceRef: ref };
    // PixelForge-style importer: when the font really is a pixel font there is
    // one cell size at which every cell is either empty or completely full.
    // Detect it before triggering store updates and toast timers.
    const found = bdf ? null : detectImportedPixelGrid(imported);
    const current = useStore.getState();
    releasePreview(slot);
    current.loadFont(slot, imported, fileName);
    current.setActive(slot);
    releaseSourcesNotIn(before, [useStore.getState().fonts.A, useStore.getState().fonts.B]);
    if (bdf) {
      current.toast(
        'success',
        `Imported BDF “${doc.meta.fontFamily}” into Font ${slot} as a pixel font: ${bdf.cellWidth}×${bdf.cellHeight} px cells${bdf.monospaced ? ' (monospaced)' : ' (proportional)'}, ${bdf.baselineRow} row${bdf.baselineRow === 1 ? '' : 's'} below the baseline, ${bdf.glyphCount} glyphs.`,
      );
    } else {
      current.toast('success', `Imported “${doc.meta.fontFamily}” (${doc.glyphs.length} glyphs) into Font ${slot}${origin ? ` from ${origin}` : ''}.`);
    }
    warnings.forEach((w) => current.toast('warning', w));

    if (found?.found && found.grid) {
      const grid = found.grid;
      current.toast(
        'info',
        `“${doc.meta.fontFamily}” is a pixel font: a ${grid.rows}-row grid of ${Math.round(grid.unitsPerCell * 100) / 100} units per pixel fits every outline exactly. Convert it to keep editing pixels.`,
      );
      useStore.getState().openModal({ type: 'rasterize', slot, scope: 'font' });
    }
    return true;
  } catch (err) {
    useStore.getState().toast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  } finally {
    useStore.getState().setBusy(null);
  }
}

/** Import font bytes already in memory (asks before replacing unsaved work). */
export async function importFontBuffer(slot: Slot, buffer: ArrayBuffer, fileName: string, origin?: string): Promise<boolean> {
  const store = useStore.getState();
  if (store.fonts[slot] && !(await confirmDiscardChanges([slot], `Importing “${fileName}” into Font ${slot}`))) return false;
  return loadFontBuffer(slot, buffer, fileName, origin);
}

/** Import a font file into a workspace slot (asks before replacing unsaved work). */
export async function importFontFile(slot: Slot, file: File): Promise<void> {
  const store = useStore.getState();
  if (store.fonts[slot] && !(await confirmDiscardChanges([slot], `Importing “${file.name}” into Font ${slot}`))) return;
  if (!FONT_FILE_RE.test(file.name)) {
    // the content decides what it really is; the name only triggers a hint
    store.toast('info', `“${file.name}” has an unusual extension (expected ${FONT_FILE_LABEL}); trying to read it anyway.`);
  }
  store.setBusy(`Reading ${file.name}…`);
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    useStore.getState().setBusy(null);
    useStore.getState().toast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  await loadFontBuffer(slot, buffer, file.name);
}

/**
 * Download one font from the ESPHome MAX7219 Matrix Clock repository and
 * load it into a workspace slot (asks, before downloading, before replacing
 * unsaved work). Resolves true when the font was loaded.
 */
export async function importMatrixClockFont(slot: Slot, font: MatrixClockOnlineFont): Promise<boolean> {
  const store = useStore.getState();
  if (store.fonts[slot] && !(await confirmDiscardChanges([slot], `Loading “${font.fileName}” from the Matrix Clock into Font ${slot}`))) return false;
  store.setBusy(`Downloading ${font.fileName} from the Matrix Clock…`);
  let buffer: ArrayBuffer;
  try {
    buffer = await fetchMatrixClockFontBytes(font);
  } catch (err) {
    useStore.getState().setBusy(null);
    useStore.getState().toast('error', `Matrix Clock download failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  return loadFontBuffer(slot, buffer, font.fileName, `the Matrix Clock (${font.path})`);
}

/** Load a project file into both workspaces. */
export async function openProjectFile(file: File): Promise<void> {
  const store = useStore.getState();
  store.setBusy(`Reading project ${file.name}…`);
  let res: Awaited<ReturnType<typeof parseProjectFile>>;
  try {
    res = await parseProjectFile(file);
  } catch (err) {
    store.setBusy(null);
    store.toast('error', err instanceof Error ? err.message : String(err));
    return;
  }
  // the busy overlay would cover the confirmation, so ask once the file is known to be valid
  store.setBusy(null);
  if (!(await confirmDiscardChanges(['A', 'B'], `Opening “${file.name}”`))) {
    // the restored sources were registered by the parser; they belong to nothing now
    releaseSourcesNotIn([res.fonts.A, res.fonts.B], []);
    return;
  }
  const before = [useStore.getState().fonts.A, useStore.getState().fonts.B];
  releasePreview('A');
  releasePreview('B');
  const current = useStore.getState();
  current.loadFont('A', res.fonts.A, res.fonts.A ? file.name : null);
  current.loadFont('B', res.fonts.B, res.fonts.B ? file.name : null);
  current.setActive(res.active);
  current.setTheme(res.theme);
  current.setLastProjectSavedAt(res.savedAt);
  releaseSourcesNotIn(before, [res.fonts.A, res.fonts.B]);
  current.toast('success', `Project loaded: ${[res.fonts.A, res.fonts.B].filter(Boolean).length} font(s) restored.`);
}
