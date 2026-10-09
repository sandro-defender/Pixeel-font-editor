/**
 * Persistence:
 *  - automatic IndexedDB recovery snapshots (survive refresh/crash)
 *  - explicit project file save/load (.pixeel.json)
 */
import type { FontDoc, Slot } from '../core/types';
import { deserializeProject, serializeProject, type SerializedProject } from '../core/project';
import { clearRecovery, loadRecovery, saveRecovery } from '../core/idb';
import { getSource, registerSource, unregisterSource } from '../core/sourceRegistry';
import type { TtfLike } from '../core/fontCodec';

export interface PersistedState {
  fonts: { A: FontDoc | null; B: FontDoc | null };
  active: Slot;
  theme: 'light' | 'dark';
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshotJson = '';

/** Debounced auto-save into IndexedDB. */
export function scheduleRecoverySave(state: PersistedState, delayMs = 2500): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void saveRecoveryNow(state);
  }, delayMs);
}

export async function saveRecoveryNow(state: PersistedState): Promise<boolean> {
  try {
    const payload = serializeProject(state.fonts, state.active, { theme: state.theme });
    const json = JSON.stringify(payload);
    if (json === lastSnapshotJson) return false;
    lastSnapshotJson = json;
    await saveRecovery(payload);
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

export async function restoreRecovery(): Promise<{ fonts: { A: FontDoc | null; B: FontDoc | null }; active: Slot; theme: 'light' | 'dark'; savedAt: number } | null> {
  const rec = await loadRecovery();
  if (!rec) return null;
  const { project } = deserializeProject(JSON.stringify(rec.payload));
  lastSnapshotJson = JSON.stringify(rec.payload);
  return { fonts: project.fonts, active: project.active, theme: project.settings.theme, savedAt: rec.savedAt };
}

export async function discardRecovery(): Promise<void> {
  lastSnapshotJson = '';
  await clearRecovery();
}

// ---------------------------------------------------------------------------
// Project files
// ---------------------------------------------------------------------------

export function downloadProjectFile(state: PersistedState, fileHandleName?: string): string {
  const payload = serializeProject(state.fonts, state.active, { theme: state.theme });
  const name = fileHandleName ?? 'pixeel-project.pixeel.json';
  downloadBlob(new Blob([JSON.stringify(payload)], { type: 'application/json' }), name);
  return name;
}

export async function parseProjectFile(file: File): Promise<{
  fonts: { A: FontDoc | null; B: FontDoc | null };
  active: Slot;
  theme: 'light' | 'dark';
  savedAt: number;
  restoredSources: number;
}> {
  const text = await file.text();
  const { project, restoredSources } = deserializeProject(text);
  return { fonts: project.fonts, active: project.active, theme: project.settings.theme, savedAt: project.savedAt, restoredSources };
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
