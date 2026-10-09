/** App shell: layout, drag&drop import, auto-recovery, global shortcuts. */
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from './state/store';
import { TopBar } from './components/TopBar';
import { GlyphBrowser } from './components/GlyphBrowser';
import { EditorPanel } from './components/EditorPanel';
import { SidePanel } from './components/SidePanel';
import { BusyOverlay, Btn, Toasts } from './components/ui';
import { AddGlyphDialog, ExportDialog, HelpDialog, LedMatrixDialog, MetadataDialog, NewFontDialog, PixelCodeDialog, RasterizeDialog, ResizeGridDialog, TransferDialog } from './components/dialogs';
import { importFontFile, openProjectFile, saveProjectFile } from './services/fileActions';
import { discardRecovery, peekRecovery, restoreRecovery, saveRecoveryNow, scheduleRecoverySave } from './services/persistence';
import { releaseAllPreviews } from './services/previewFont';

function RecoveryBanner() {
  const info = useStore((s) => s.recoveryAvailable);
  const setRecoveryAvailable = useStore((s) => s.setRecoveryAvailable);
  const toast = useStore((s) => s.toast);
  const loadFont = useStore((s) => s.loadFont);
  const setActive = useStore((s) => s.setActive);
  const setTheme = useStore((s) => s.setTheme);
  if (!info) return null;
  return (
    <div className="recovery-banner" role="alert">
      <span>
        A recovery snapshot from <strong>{new Date(info.savedAt).toLocaleString()}</strong> was found after the last session.
      </span>
      <Btn
        kind="primary"
        onClick={async () => {
          const res = await restoreRecovery();
          if (res) {
            loadFont('A', res.fonts.A, res.fonts.A ? 'recovered' : null);
            loadFont('B', res.fonts.B, res.fonts.B ? 'recovered' : null);
            setActive(res.active);
            setTheme(res.theme);
            toast('success', 'Recovery snapshot restored. Save it as a project file to keep it.');
          }
          setRecoveryAvailable(null);
        }}
      >
        Restore
      </Btn>
      <Btn
        onClick={async () => {
          await discardRecovery();
          setRecoveryAvailable(null);
        }}
      >
        Discard
      </Btn>
    </div>
  );
}

function EmptyWorkspace() {
  const openModal = useStore((s) => s.openModal);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="dropzone">
      <h1>Pixeel — pixel & TTF font editor</h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Create pixel fonts from scratch, or open an existing .ttf and edit its outlines. Everything runs in your browser —
        fonts never leave your device. Drop a .ttf anywhere to import it into Font A / Font B.
      </p>
      <div className="drop-actions">
        <Btn kind="primary" onClick={() => openModal({ type: 'newFont' })}>🆕 Create a new font</Btn>
        <Btn onClick={() => fileRef.current?.click()}>📂 Open a .ttf / .otf</Btn>
        <Btn onClick={() => useStore.getState().openModal({ type: 'help' })}>? Help</Btn>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".ttf,.otf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFontFile(useStore.getState().active, f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function Modals() {
  const modal = useStore((s) => s.modal);
  switch (modal.type) {
    case 'newFont': return <NewFontDialog />;
    case 'metadata': return <MetadataDialog slot={useStore.getState().active} />;
    case 'export': return <ExportDialog slot={modal.slot} />;
    case 'transfer': return <TransferDialog from={modal.from} glyphIds={modal.glyphIds} mode={modal.mode} />;
    case 'resizeGrid': return <ResizeGridDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'rasterize': return <RasterizeDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'addGlyph': return <AddGlyphDialog slot={modal.slot} />;
    case 'pixelCode': return <PixelCodeDialog slot={modal.slot} glyphId={modal.glyphId} />;
    case 'ledMatrix': return <LedMatrixDialog slot={modal.slot} />;
    case 'help': return <HelpDialog />;
    default: return null;
  }
}

function StatusBar() {
  const fonts = useStore((s) => s.fonts);
  const active = useStore((s) => s.active);
  const fileNames = useStore((s) => s.fileNames);
  const dirty = useStore((s) => s.dirty);
  const lastSaved = useStore((s) => s.lastProjectSavedAt);
  const doc = fonts[active];
  return (
    <footer className="statusbar" aria-label="Status">
      <span>Active: <strong>Font {active}</strong>{doc ? ` — ${doc.meta.fontFamily} ${doc.meta.fontSubFamily}` : ' (empty)'}</span>
      {doc && <span>{fileNames[active] ?? 'unsaved'}</span>}
      {doc && <span>{doc.glyphs.length} glyphs · upm {doc.metrics.unitsPerEm}</span>}
      {doc && <span>{dirty[active] ? '● unsaved changes' : '✓ saved'}</span>}
      {lastSaved && <span>project last saved {new Date(lastSaved).toLocaleTimeString()}</span>}
      <span className="spacer" />
      <span>Fonts stay on your device — nothing is uploaded.</span>
    </footer>
  );
}

export default function App() {
  const active = useStore((s) => s.active);
  const fonts = useStore((s) => s.fonts);
  const theme = useStore((s) => s.theme);
  const [dragging, setDragging] = useState(false);

  // theme attribute
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // recovery check on startup
  useEffect(() => {
    let mounted = true;
    peekRecovery().then((info) => {
      if (mounted && info && Date.now() - info.savedAt > 15_000) {
        useStore.getState().setRecoveryAvailable(info);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // auto-save recovery snapshot whenever fonts change
  useEffect(() => {
    const unsub = useStore.subscribe((s, prev) => {
      if (s.previewVersion !== prev.previewVersion && (s.fonts.A || s.fonts.B)) {
        scheduleRecoverySave({ fonts: s.fonts, active: s.active, theme: s.theme });
      }
    });
    return unsub;
  }, []);

  // save state on tab close
  useEffect(() => {
    const onUnload = () => {
      const s = useStore.getState();
      if (s.fonts.A || s.fonts.B) {
        void saveRecoveryNow({ fonts: s.fonts, active: s.active, theme: s.theme });
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      releaseAllPreviews();
    };
  }, []);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // a component (e.g. the pixel editor) already handled this key
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo(s.active);
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        s.redo(s.active);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drag & drop font files
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.(ttf|otf|json)$/i.test(f.name));
      if (!files.length) return;
      const s = useStore.getState();
      for (const f of files) {
        if (f.name.endsWith('.json')) {
          await openProjectFile(f);
        } else {
          const slot = !s.fonts.A ? 'A' : !s.fonts.B ? 'B' : s.active;
          await importFontFile(slot, f);
        }
      }
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  const hasAny = fonts.A !== null || fonts.B !== null;

  return (
    <div className={`app ${dragging ? 'dragging' : ''}`}>
      <TopBar />
      <RecoveryBanner />
      {!hasAny ? (
        <EmptyWorkspace />
      ) : (
        <div className="main">
          {fonts[active] && <GlyphBrowser slot={active} />}
          {fonts[active] ? <EditorPanel slot={active} /> : <EmptyWorkspace />}
          <SidePanel slot={active} />
        </div>
      )}
      <StatusBar />
      <Modals />
      <Toasts />
      <BusyOverlay />
      {dragging && (
        <div className="dropzone drag" style={{ position: 'fixed', inset: 0, zIndex: 100, margin: 0, borderRadius: 0, pointerEvents: 'none' }}>
          <h1>Drop .ttf / .otf / project files</h1>
        </div>
      )}
    </div>
  );
}
