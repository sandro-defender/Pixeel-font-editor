/** App header: workspace tabs, file actions, undo/redo, theme. */
import React, { useRef } from 'react';
import { useStore, workspaceName } from '../state/store';
import type { Slot } from '../core/types';
import { Btn, IconBtn } from './ui';
import { importFontFile, openProjectFile, saveProjectFile } from '../services/fileActions';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);

  const tab = (slot: Slot) => {
    const doc = fonts[slot];
    return (
      <button
        key={slot}
        className={`ws-tab ${active === slot ? 'active' : ''}`}
        onClick={() => setActive(slot)}
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
