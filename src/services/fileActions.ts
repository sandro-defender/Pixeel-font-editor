/** File-level actions shared between TopBar, App drag&drop and dialogs. */
import { useStore } from '../state/store';
import { importFont } from '../core/fontCodec';
import { registerImportedSource, downloadProjectFile, parseProjectFile, dropSource } from './persistence';
import { releasePreview } from './previewFont';

/** Save the current workspaces as a downloadable project file. */
export function saveProjectFile(): void {
  const s = useStore.getState();
  if (!s.fonts.A && !s.fonts.B) {
    s.toast('warning', 'Nothing to save yet — create or open a font first.');
    return;
  }
  const name = downloadProjectFile({ fonts: s.fonts, active: s.active, theme: s.theme });
  s.setLastProjectSavedAt(Date.now());
  s.toast('success', `Project saved as ${name}. Both fonts, metadata, pixel grids and settings are included.`);
}

/** Import a font file into a workspace slot. */
export async function importFontFile(slot: 'A' | 'B', file: File): Promise<void> {
  const store = useStore.getState();
  if (!/\.(ttf|otf)$/i.test(file.name) && !file.type.includes('font')) {
    store.toast('warning', `"${file.name}" does not look like a font file. Supported: .ttf (TrueType) and .otf (CFF, converted to quadratic on import).`);
  }
  store.setBusy(`Reading ${file.name}…`);
  try {
    const buffer = await file.arrayBuffer();
    const { doc, sourceTtf, warnings } = await importFont(buffer, file.name);
    const ref = registerImportedSource(sourceTtf);
    const old = store.fonts[slot];
    if (old?.sourceRef) {
      // drop the replaced font's source data unless the other slot shares it
      const other = store.fonts[slot === 'A' ? 'B' : 'A'];
      if (other?.sourceRef !== old.sourceRef) dropSource(old.sourceRef);
    }
    releasePreview(slot);
    store.loadFont(slot, { ...doc, sourceRef: ref }, file.name);
    store.setActive(slot);
    store.toast('success', `Imported "${doc.meta.fontFamily}" (${doc.glyphs.length} glyphs) into Font ${slot}.`);
    warnings.forEach((w) => store.toast('warning', w));
  } catch (err) {
    store.toast('error', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    store.setBusy(null);
  }
}

/** Load a project file into both workspaces. */
export async function openProjectFile(file: File): Promise<void> {
  const store = useStore.getState();
  store.setBusy(`Opening project ${file.name}…`);
  try {
    const res = await parseProjectFile(file);
    releasePreview('A');
    releasePreview('B');
    store.loadFont('A', res.fonts.A, res.fonts.A ? file.name : null);
    store.loadFont('B', res.fonts.B, res.fonts.B ? file.name : null);
    store.setActive(res.active);
    store.setTheme(res.theme);
    store.setLastProjectSavedAt(res.savedAt);
    store.toast('success', `Project loaded: ${[res.fonts.A, res.fonts.B].filter(Boolean).length} font(s) restored.`);
  } catch (err) {
    store.toast('error', err instanceof Error ? err.message : String(err));
  } finally {
    store.setBusy(null);
  }
}
