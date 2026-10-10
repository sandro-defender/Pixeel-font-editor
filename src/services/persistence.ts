/**
 * Persistence:
 *  - automatic IndexedDB recovery snapshots (survive refresh/crash)
 *  - explicit project file save/load (.pixeel.json)
 */
import type { FontDoc, Slot } from '../core/types';
import { deserializeProject, serializeProject, type DeserializedProject, type SerializedProject } from '../core/project';
import { clearRecovery, loadRecovery, saveRecovery } from '../core/idb';
import { getSource, registerSource, unregisterSource } from '../core/sourceRegistry';
import type { TtfLike } from '../core/fontCodec';

export interface PersistedState {
  fonts: { A: FontDoc | null; B: FontDoc | null };
  active: Slot;
  theme: 'light' | 'dark';
}

let timer: ReturnType<typeof setTimeout> | null = null;
/** Content key of the last snapshot written (or restored); unchanged content is not written again. */
let lastSnapshotKey = '';

/**
 * Identity of the saved content. It deliberately excludes timestamps (the
 * project's `savedAt` changes on every serialization) so that identical
 * states are recognised and not written twice.
 */
function contentKey(state: PersistedState): string {
  const refs = [state.fonts.A?.sourceRef ?? '', state.fonts.B?.sourceRef ?? ''].join(',');
  return `${JSON.stringify({ fonts: state.fonts, active: state.active, theme: state.theme })}|${refs}`;
}

/** Debounced auto-save into IndexedDB. */
export function scheduleRecoverySave(state: PersistedState, delayMs = 2500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void saveRecoveryNow(state);
  }, delayMs);
}

export function cancelScheduledRecoverySave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export async function saveRecoveryNow(state: PersistedState): Promise<boolean> {
  try {
    const key = contentKey(state);
    if (key === lastSnapshotKey) return false;
    const payload = serializeProject(state.fonts, state.active, { theme: state.theme });
    await saveRecovery(payload);
    lastSnapshotKey = key;
    return true;
  } catch (err) {
    console.warn('Recovery save failed:', err);
    return false;
  }
}

export async function peekRecovery(): Promise<{ savedAt: number } | null> {
  try {
    const rec = await loadRecovery();
    return rec ? { savedAt: rec.savedAt } : null;
  } catch {
    return null;
  }
}

/**
 * Register the sources of a parsed project in the registry and point the fonts at the new refs.
 * Fonts whose source is missing from the file lose their reference (export rebuilds from the outlines).
 */
function adoptProject(parsed: DeserializedProject): PersistedState & { savedAt: number; sourceRefs: string[] } {
  const remap: Record<string, string> = {};
  for (const [ref, ttf] of Object.entries(parsed.sources)) remap[ref] = registerSource(ttf);
  const fix = (font: FontDoc | null): FontDoc | null => {
    if (!font) return null;
    const ref = font.sourceRef && remap[font.sourceRef] ? remap[font.sourceRef] : null;
    return { ...font, sourceRef: ref };
  };
  const fonts = { A: fix(parsed.project.fonts.A), B: fix(parsed.project.fonts.B) };
  return {
    fonts,
    active: parsed.project.active,
    theme: parsed.project.settings.theme,
    savedAt: parsed.project.savedAt,
    sourceRefs: Object.values(remap),
  };
}

export async function restoreRecovery(): Promise<(PersistedState & { savedAt: number }) | null> {
  const rec = await loadRecovery();
  if (!rec) return null;
  const adopted = adoptProject(deserializeProject(JSON.stringify(rec.payload)));
  // the restored state is already on disk in IndexedDB: remember its content key
  lastSnapshotKey = contentKey(adopted);
  return { fonts: adopted.fonts, active: adopted.active, theme: adopted.theme, savedAt: rec.savedAt };
}

export async function discardRecovery(): Promise<void> {
  lastSnapshotKey = '';
  await clearRecovery();
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

/** A readable default file name for a project, based on the font families it contains. */
export function projectFileName(fonts: PersistedState['fonts']): string {
  const family = fonts.A?.meta.fontFamily ?? fonts.B?.meta.fontFamily ?? '';
  const safe = family
    .trim()
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safe || 'pixeel-project'}.pixeel.json`;
}

export function downloadProjectFile(state: PersistedState, fileName?: string): string {
  const payload = serializeProject(state.fonts, state.active, { theme: state.theme });
  const name = fileName ?? projectFileName(state.fonts);
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), name);
  return name;
}

/** Read a project file. Sources are registered; the caller owns them (see releaseSourcesNotIn). */
export async function parseProjectFile(file: File): Promise<PersistedState & { savedAt: number }> {
  const text = await file.text();
  const adopted = adoptProject(deserializeProject(text));
  return { fonts: adopted.fonts, active: adopted.active, theme: adopted.theme, savedAt: adopted.savedAt };
}

export function registerImportedSource(ttf: TtfLike): string {
  return registerSource(ttf);
}

export function dropSource(ref: string | null): void {
  unregisterSource(ref);
}

export function sourceFor(ref: string | null): TtfLike | null {
  return getSource(ref);
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // release on the next tick so the click completes
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadArrayBuffer(buffer: ArrayBuffer, fileName: string, mime = 'font/ttf'): void {
  downloadBlob(new Blob([buffer], { type: mime }), fileName);
}

export type { SerializedProject };
