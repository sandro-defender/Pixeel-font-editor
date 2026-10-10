/** File-level actions shared between the top bar, drag & drop and dialogs. */
import { useStore } from '../state/store';
import type { FontDoc, Slot } from '../core/types';
import { importFont } from '../core/fontCodec';
import { dropSource, downloadProjectFile, parseProjectFile, projectFileName, registerImportedSource } from './persistence';
import { releasePreview } from './previewFont';

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

/** Import a font file into a workspace slot (asks before replacing unsaved work). */
export async function importFontFile(slot: Slot, file: File): Promise<void> {
  const store = useStore.getState();
  if (store.fonts[slot] && !(await confirmDiscardChanges([slot], `Importing “${file.name}” into Font ${slot}`))) return;
  if (!/\.(ttf|otf)$/i.test(file.name)) {
    store.toast('warning', `“${file.name}” does not look like a TrueType or OpenType font (.ttf / .otf).`);
  }
  store.setBusy(`Reading ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    const { doc, sourceTtf, warnings } = await importFont(buffer, file.name);
    const ref = registerImportedSource(sourceTtf);
    const before = [useStore.getState().fonts.A, useStore.getState().fonts.B];
    const imported = { ...doc, sourceRef: ref };
    const current = useStore.getState();
    releasePreview(slot);
    current.loadFont(slot, imported, file.name);
    current.setActive(slot);
    releaseSourcesNotIn(before, [useStore.getState().fonts.A, useStore.getState().fonts.B]);
    current.toast('success', `Imported “${doc.meta.fontFamily}” (${doc.glyphs.length} glyphs) into Font ${slot}.`);
    warnings.forEach((w) => current.toast('warning', w));
  } catch (err) {
    useStore.getState().toast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    useStore.getState().setBusy(null);
  }
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
