/** App header: workspace tabs, file actions, undo/redo, theme. */
import React, { useRef, useState } from 'react';
import { useStore, workspaceName } from '../state/store';
import type { Slot } from '../core/types';
import { Btn, IconBtn } from './ui';
import { importFontFile, openProjectFile, saveProjectFile } from '../services/fileActions';
import { dragFromOther, readGlyphDrag } from './glyphDrag';

export function TopBar() {
  const fonts = useStore((s) => s.fonts);
  const fileNames = useStore((s) => s.fileNames);
  const active = useStore((s) => s.active);
  const dirty = useStore((s) => s.dirty);
  const setActive = useStore((s) => s.setActive);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const openModal = useStore((s) => s.openModal);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const [dropSlot, setDropSlot] = useState<Slot | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const tab = (slot: Slot) => {
    const doc = fonts[slot];
    return (
      <button
        key={slot}
        className={`ws-tab ${active === slot ? 'active' : ''} ${dropSlot === slot ? 'drop-target' : ''}`}
        onClick={() => setActive(slot)}
        onDragOver={(e) => {
          // glyph cards dragged from the other font can be dropped here to copy them
          if (dragFromOther(e.dataTransfer, slot)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (dropSlot !== slot) setDropSlot(slot);
          }
        }}
        onDragLeave={() => setDropSlot((cur) => (cur === slot ? null : cur))}
        onDrop={(e) => {
          const from = dragFromOther(e.dataTransfer, slot);
          setDropSlot(null);
          if (!from) return;
          e.preventDefault();
          e.stopPropagation();
          const ids = readGlyphDrag(e.dataTransfer, from);
          if (ids && ids.length) openModal({ type: 'transfer', from, glyphIds: ids, mode: 'copy' });
        }}
        title={doc ? `${workspaceName(slot)}: ${doc.meta.fontFamily}` : `${workspaceName(slot)}: empty`}
        aria-pressed={active === slot}
      >
        <span>{workspaceName(slot)}</span>
        {doc && <span className="fname">{fileNames[slot] ?? doc.meta.fontFamily}</span>}
        <span className={`dot ${doc && dirty[slot] ? '' : 'hidden'}`} title="Unsaved changes" />
      </button>
    );
  };

  return (
    <header className="topbar">
      <div className="brand" title="Pixeel — browser TTF font editor">
        <span className="px" aria-hidden><i /><i /><i /><i /></span> Pixeel
      </div>
      <div className="ws-tabs" role="tablist" aria-label="Font workspaces">{tab('A')}{tab('B')}</div>
      <div className="top-actions">
        <Btn tip="Create a brand-new pixel font" onClick={() => openModal({ type: 'newFont' })}>🆕 New</Btn>
        <Btn tip="Open a .ttf/.otf font into the active workspace" onClick={() => fileInputRef.current?.click()}>📂 Open font</Btn>
        <Btn tip="Open a saved Pixeel project (.pixeel.json) with both fonts" onClick={() => projectInputRef.current?.click()}>🗂 Open project</Btn>
        <Btn tip="Save both fonts, metadata and settings as a project file" onClick={saveProjectFile}>💾 Save project</Btn>
        <Btn kind="primary" tip="Export the active font as a validated .ttf" disabled={!fonts[active]} onClick={() => openModal({ type: 'export', slot: active })}>⬇ Export TTF</Btn>
        <Btn tip="Font metadata & license" disabled={!fonts[active]} onClick={() => openModal({ type: 'metadata' })}>ℹ Info</Btn>
        <Btn tip="Exact-pixel LED matrix settings (fixed grid height, whole-pixel metrics)" disabled={!fonts[active]} onClick={() => openModal({ type: 'ledMatrix', slot: active })}>
          {fonts[active]?.ledMatrix ? '💡 LED matrix' : '💡 LED matrix…'}
        </Btn>
        <span className="sep" style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <IconBtn icon="↶" tip={`Undo in ${workspaceName(active)} (Ctrl+Z)`} disabled={past[active].length === 0} onClick={() => undo(active)} />
        <IconBtn icon="↷" tip={`Redo in ${workspaceName(active)} (Ctrl+Y)`} disabled={future[active].length === 0} onClick={() => redo(active)} />
        <IconBtn icon={theme === 'dark' ? '☀' : '🌙'} tip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <IconBtn icon="?" tip="Help & keyboard shortcuts" onClick={() => openModal({ type: 'help' })} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,font/ttf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFontFile(useStore.getState().active, f);
          e.target.value = '';
        }}
        aria-label="Open font file"
      />
      <input
        ref={projectInputRef}
        type="file"
        accept=".json,.pixeel.json,application/json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void openProjectFile(f);
          e.target.value = '';
        }}
        aria-label="Open project file"
      />
    </header>
  );
}
