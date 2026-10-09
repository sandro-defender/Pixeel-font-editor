/** Global application state (zustand). */
import { create } from 'zustand';
import type { FontDoc, GlyphDoc, Slot, WorkspaceSettings } from '../core/types';
import { makeId } from '../core/types';

export const HISTORY_LIMIT = 50;

export interface Toast {
  id: string;
  kind: 'error' | 'info' | 'success' | 'warning';
  text: string;
}

export type ModalState =
  | { type: 'none' }
  | { type: 'newFont' }
  | { type: 'openProject' }
  | { type: 'metadata' }
  | { type: 'export'; slot: Slot }
  | { type: 'transfer'; from: Slot; glyphIds: string[] }
  | { type: 'resizeGrid'; slot: Slot; glyphId: string }
  | { type: 'rasterize'; slot: Slot; glyphId: string }
  | { type: 'addGlyph'; slot: Slot }
  | { type: 'help' };

interface FontSlotUI {
  glyphId: string | null;
  glyphListSearch: string;
  glyphListFilter: 'all' | 'mapped' | 'unmapped' | 'edited';
  multiSelected: string[];
  zoom: number;
  tool: 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'select';
  overlayGlyphId: string | null;
  showGrid: boolean;
}

export interface AppStore {
  fonts: { A: FontDoc | null; B: FontDoc | null };
  fileNames: { A: string | null; B: string | null };
  active: Slot;
  dirty: { A: boolean; B: boolean };
  ui: { A: FontSlotUI; B: FontSlotUI };
  theme: 'light' | 'dark';
  busy: string | null;
  toasts: Toast[];
  modal: ModalState;
  recoveryAvailable: { savedAt: number } | null;
  /** bump on every font mutation; preview builder watches it */
  previewVersion: number;
  lastProjectSavedAt: number | null;

  past: Record<Slot, FontDoc[]>;
  future: Record<Slot, FontDoc[]>;

  // --- core actions
  setActive: (slot: Slot) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setBusy: (msg: string | null) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: string) => void;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  setRecoveryAvailable: (info: { savedAt: number } | null) => void;
  setLastProjectSavedAt: (t: number | null) => void;

  // --- font lifecycle
  loadFont: (slot: Slot, doc: FontDoc | null, fileName: string | null) => void;
  commit: (slot: Slot, label: string, updater: (doc: FontDoc) => FontDoc) => void;
  undo: (slot: Slot) => void;
  redo: (slot: Slot) => void;
  canUndo: (slot: Slot) => boolean;
  canRedo: (slot: Slot) => boolean;

  // --- selection
  selectGlyph: (slot: Slot, glyphId: string | null) => void;
  toggleMultiSelect: (slot: Slot, glyphId: string) => void;
  setMultiSelect: (slot: Slot, ids: string[]) => void;
  setListSearch: (slot: Slot, q: string) => void;
  setListFilter: (slot: Slot, f: FontSlotUI['glyphListFilter']) => void;
  setZoom: (slot: Slot, zoom: number) => void;
  setTool: (slot: Slot, tool: FontSlotUI['tool']) => void;
  setOverlayGlyph: (slot: Slot, id: string | null) => void;
  toggleGridLines: (slot: Slot) => void;
}

const defaultSlotUI = (): FontSlotUI => ({
  glyphId: null,
  glyphListSearch: '',
  glyphListFilter: 'all',
  multiSelected: [],
  zoom: 16,
  tool: 'pencil',
  overlayGlyphId: null,
  showGrid: true,
});

export const useStore = create<AppStore>((set, get) => ({
  fonts: { A: null, B: null },
  fileNames: { A: null, B: null },
  active: 'A',
  dirty: { A: false, B: false },
  ui: { A: defaultSlotUI(), B: defaultSlotUI() },
  theme: typeof window !== 'undefined' && (window.matchMedia?.('(prefers-color-scheme: dark)')?.matches) ? 'dark' : 'light',
  busy: null,
  toasts: [],
  modal: { type: 'none' },
  recoveryAvailable: null,
  previewVersion: 0,
  lastProjectSavedAt: null,
  past: { A: [], B: [] },
  future: { A: [], B: [] },

  setActive: (slot) => set({ active: slot }),
  setTheme: (theme) => set({ theme }),
  setBusy: (msg) => set({ busy: msg }),

  toast: (kind, text) => {
    const id = makeId('t');
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, text }] }));
    const ttl = kind === 'error' ? 9000 : kind === 'warning' ? 7000 : 4500;
    setTimeout(() => get().dismissToast(id), ttl);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: { type: 'none' } }),
  setRecoveryAvailable: (info) => set({ recoveryAvailable: info }),
  setLastProjectSavedAt: (t) => set({ lastProjectSavedAt: t }),

  loadFont: (slot, doc, fileName) =>
    set((s) => ({
      fonts: { ...s.fonts, [slot]: doc },
      fileNames: { ...s.fileNames, [slot]: fileName },
      dirty: { ...s.dirty, [slot]: false },
      past: { ...s.past, [slot]: [] },
      future: { ...s.future, [slot]: [] },
      ui: {
        ...s.ui,
        [slot]: {
          ...defaultSlotUI(),
          glyphId: doc ? doc.glyphs[0]?.id ?? null : null,
          zoom: s.ui[slot].zoom,
        },
      },
      previewVersion: s.previewVersion + 1,
    })),

  commit: (slot, label, updater) => {
    const s = get();
    const doc = s.fonts[slot];
    if (!doc) return;
    let next: FontDoc;
    try {
      next = updater(doc);
    } catch (err) {
      s.toast('error', err instanceof Error ? err.message : String(err));
      return;
    }
    if (next === doc) return;
    set({
      fonts: { ...s.fonts, [slot]: next },
      dirty: { ...s.dirty, [slot]: true },
      past: { ...s.past, [slot]: [...s.past[slot].slice(-(HISTORY_LIMIT - 1)), doc] },
      future: { ...s.future, [slot]: [] },
      previewVersion: s.previewVersion + 1,
    });
  },

  undo: (slot) => {
    const s = get();
    const doc = s.fonts[slot];
    const past = s.past[slot];
    if (!doc || past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      fonts: { ...s.fonts, [slot]: prev },
      past: { ...s.past, [slot]: past.slice(0, -1) },
      future: { ...s.future, [slot]: [...s.future[slot], doc].slice(-HISTORY_LIMIT) },
      dirty: { ...s.dirty, [slot]: true },
      previewVersion: s.previewVersion + 1,
      ui: { ...s.ui, [slot]: { ...s.ui[slot], glyphId: prev.glyphs.some((g) => g.id === s.ui[slot].glyphId) ? s.ui[slot].glyphId : prev.glyphs[0]?.id ?? null } },
    });
  },

  redo: (slot) => {
    const s = get();
    const doc = s.fonts[slot];
    const future = s.future[slot];
    if (!doc || future.length === 0) return;
    const next = future[future.length - 1];
    set({
      fonts: { ...s.fonts, [slot]: next },
      future: { ...s.future, [slot]: future.slice(0, -1) },
      past: { ...s.past, [slot]: [...s.past[slot], doc].slice(-HISTORY_LIMIT) },
      dirty: { ...s.dirty, [slot]: true },
      previewVersion: s.previewVersion + 1,
      ui: { ...s.ui, [slot]: { ...s.ui[slot], glyphId: next.glyphs.some((g) => g.id === s.ui[slot].glyphId) ? s.ui[slot].glyphId : next.glyphs[0]?.id ?? null } },
    });
  },

  canUndo: (slot) => get().past[slot].length > 0,
  canRedo: (slot) => get().future[slot].length > 0,

  selectGlyph: (slot, glyphId) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], glyphId } } })),
  toggleMultiSelect: (slot, glyphId) =>
    set((s) => {
      const cur = s.ui[slot].multiSelected;
      const next = cur.includes(glyphId) ? cur.filter((x) => x !== glyphId) : [...cur, glyphId];
      return { ui: { ...s.ui, [slot]: { ...s.ui[slot], multiSelected: next } } };
    }),
  setMultiSelect: (slot, ids) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], multiSelected: ids } } })),
  setListSearch: (slot, q) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], glyphListSearch: q } } })),
  setListFilter: (slot, f) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], glyphListFilter: f } } })),
  setZoom: (slot, zoom) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], zoom: Math.min(64, Math.max(2, zoom)) } } })),
  setTool: (slot, tool) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], tool } } })),
  setOverlayGlyph: (slot, id) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], overlayGlyphId: id } } })),
  toggleGridLines: (slot) =>
    set((s) => ({ ui: { ...s.ui, [slot]: { ...s.ui[slot], showGrid: !s.ui[slot].showGrid } } })),
}));

// ---------------------------------------------------------------------------
// Convenience selectors / helpers
// ---------------------------------------------------------------------------

export function activeFont(s: AppStore): FontDoc | null {
  return s.fonts[s.active];
}

export function activeGlyph(s: AppStore): GlyphDoc | null {
  const doc = s.fonts[s.active];
  const id = s.ui[s.active].glyphId;
  return doc?.glyphs.find((g) => g.id === id) ?? null;
}

export function workspaceName(slot: Slot): string {
  return slot === 'A' ? 'Font A' : 'Font B';
}

export type { GlyphDoc, FontDoc };
