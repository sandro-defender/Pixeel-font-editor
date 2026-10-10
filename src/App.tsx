/** App shell: theme, layout, drag & drop import, auto-recovery and global shortcuts. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CssBaseline, Paper, Stack, ThemeProvider, Typography } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useStore } from './state/store';
import type { Slot } from './core/types';
import { TopBar } from './components/TopBar';
import { GlyphBrowser } from './components/GlyphBrowser';
import { EditorPanel } from './components/EditorPanel';
import { SidePanel } from './components/SidePanel';
import { BusyOverlay, ConfirmDialog, Toasts, isTextEntryTarget } from './components/ui';
import { ModalHost } from './components/dialogs';
import { CommandPalette } from './components/CommandPalette';
import { OnboardingPanel, useOnboarding } from './components/Onboarding';
import { createAppTheme } from './theme/theme';
import { importFontFile, openProjectFile, releaseSourcesNotIn, saveProjectFile } from './services/fileActions';
import { cancelScheduledRecoverySave, discardRecovery, peekRecovery, restoreRecovery, saveRecoveryNow, scheduleRecoverySave } from './services/persistence';
import { releaseAllPreviews } from './services/previewFont';

/** Offer to restore an auto-saved session found at start-up. */
function RecoveryBanner() {
  const info = useStore((s) => s.recoveryAvailable);
  const setRecoveryAvailable = useStore((s) => s.setRecoveryAvailable);
  const toast = useStore((s) => s.toast);
  if (!info) return null;

  const restore = async () => {
    setRecoveryAvailable(null);
    try {
      const res = await restoreRecovery();
      if (!res) return;
      const before = [useStore.getState().fonts.A, useStore.getState().fonts.B];
      const s = useStore.getState();
      // restored work is not saved to a file yet, so it stays marked as unsaved
      s.loadFont('A', res.fonts.A, res.fonts.A ? 'recovered' : null, { dirty: !!res.fonts.A });
      s.loadFont('B', res.fonts.B, res.fonts.B ? 'recovered' : null, { dirty: !!res.fonts.B });
      s.setActive(res.active);
      s.setTheme(res.theme);
      releaseSourcesNotIn(before, [res.fonts.A, res.fonts.B]);
      toast('success', 'Recovery snapshot restored. Save the project to keep it.');
    } catch (err) {
      toast('error', `Could not restore the recovery snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const discard = async () => {
    setRecoveryAvailable(null);
    await discardRecovery();
  };

  return (
    <Alert
      severity="info"
      variant="outlined"
      role="alert"
      sx={{ borderRadius: 0, borderLeft: 0, borderRight: 0, bgcolor: 'background.paper' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="primary" variant="contained" size="small" onClick={restore}>
            Restore
          </Button>
          <Button size="small" onClick={discard}>
            Discard
          </Button>
        </Stack>
      }
    >
      A recovery snapshot from <strong>{new Date(info.savedAt).toLocaleString()}</strong> was found after the last session.
    </Alert>
  );
}

/** Shown in a workspace that has no font yet (or in the whole window when both are empty). */
function EmptyWorkspace(props: { slot?: Slot; full?: boolean }) {
  const openModal = useStore((s) => s.openModal);
  const setActive = useStore((s) => s.setActive);
  const fileRef = useRef<HTMLInputElement>(null);
  const slot = props.slot ?? 'A';
  const title = props.full ? 'Pixeel — pixel & TTF font editor' : `Font ${slot} is empty`;

  return (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3, minHeight: 0, overflow: 'auto' }}>
      <Paper sx={{ p: { xs: 3, sm: 5 }, maxWidth: 620, width: '100%', textAlign: 'center' }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 800, fontSize: { xs: 24, sm: 30 } }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.5, mb: 3 }}>
          {props.full
            ? 'Create pixel fonts from scratch, or open an existing .ttf and edit its outlines. Everything runs in your browser — fonts never leave your device. Drop a .ttf anywhere to import it.'
            : 'Create a new font here, or open a .ttf / .otf file into this workspace.'}
        </Typography>
        <Stack sx={{ justifyContent: 'center' }} direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<NoteAddIcon />}
            onClick={() => {
              setActive(slot);
              openModal({ type: 'newFont' });
            }}
          >
            Create a new font
          </Button>
          <Button
            startIcon={<FolderOpenIcon />}
            onClick={() => {
              setActive(slot);
              fileRef.current?.click();
            }}
          >
            Open a .ttf / .otf
          </Button>
          {props.full && <Button onClick={() => openModal({ type: 'help' })}>Help</Button>}
        </Stack>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,font/ttf"
          hidden
          aria-label="Open font file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFontFile(slot, f);
            e.target.value = '';
          }}
        />
      </Paper>
    </Box>
  );
}

function StatusBar() {
  const fonts = useStore((s) => s.fonts);
  const active = useStore((s) => s.active);
  const fileNames = useStore((s) => s.fileNames);
  const dirty = useStore((s) => s.dirty);
  const lastSaved = useStore((s) => s.lastProjectSavedAt);
  const ui = useStore((s) => s.ui[active]);
  const glyphId = ui.glyphId;
  const cursor = ui.cursor;
  const sel = ui.selectionRect;
  const doc = fonts[active];
  const glyph = doc?.glyphs.find((g) => g.id === glyphId) ?? null;
  return (
    <Paper
      component="footer"
      aria-label="Status"
      square
      sx={{ px: 1.5, py: 0.5, display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', borderWidth: 0, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Typography variant="caption" color="text.secondary">
        Active: <strong>Font {active}</strong>
      </Typography>
      {doc ? (
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'primary.main' }}>
          {doc.meta.fontFamily} <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>{doc.meta.fontSubFamily}</Box>
          {doc.meta.version ? <Box component="span" sx={{ color: 'text.secondary', ml: 0.75 }}>· {doc.meta.version}</Box> : null}
          {doc.meta.designer ? <Box component="span" sx={{ color: 'text.secondary', ml: 0.75 }}>· by {doc.meta.designer}</Box> : null}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">(empty)</Typography>
      )}
      {doc && <Typography variant="caption" color="text.secondary">{fileNames[active] ?? 'not saved to a file'}</Typography>}
      {doc && (
        <Typography variant="caption" color="text.secondary">
          {doc.glyphs.length} glyphs · upm {doc.metrics.unitsPerEm}
        </Typography>
      )}
      {doc && glyph && (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          adv {glyph.advanceWidth} · LSB {glyph.leftSideBearing} · {glyph.pixel ? `${glyph.pixel.width}×${glyph.pixel.height}` : `${glyph.contours.length}c`}
        </Typography>
      )}
      {ui && (
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
          {cursor ? `cursor ${cursor.x},${cursor.y}` : 'no cursor'} · {sel ? `sel ${sel.w}×${sel.h}` : 'no sel'} · {ui.zoom}× zoom · {ui.showGrid ? 'grid' : 'no grid'} {ui.showMetricsHud ? '· HUD' : ''}
        </Typography>
      )}
      {doc && (
        <Typography variant="caption" color={dirty[active] ? 'warning.main' : 'success.main'}>
          {dirty[active] ? '● unsaved changes' : '✓ saved'}
        </Typography>
      )}
      {lastSaved && <Typography variant="caption" color="text.secondary">project last saved {new Date(lastSaved).toLocaleTimeString()}</Typography>}
      <Box sx={{ flex: 1 }} />
      <Typography variant="caption" color="text.secondary">
        Pixeel v{__APP_VERSION__} · Fonts stay on your device — nothing is uploaded.
      </Typography>
    </Paper>
  );
}

/** Global keyboard shortcuts. The pixel editor handles its own keys and calls preventDefault. */
function useGlobalShortcuts(openPalette: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      // Command palette should work even when typing, but not when a modal/confirm is open (palette itself is a dialog)
      if (mod && e.key.toLowerCase() === 'k') {
        // allow palette even if modal is none? but block if confirm is open or if palette already open handled by dialog
        if (s.confirm) return;
        // don't open if already in a modal that is not the palette (palette is managed separately)
        // we check if any MUI dialog is open via modal.type !== 'none' — still allow palette? spec says palette works when no modal is open
        // So block palette when modal is open, except we want to allow it to close? We'll block open when modal open.
        if (s.modal.type !== 'none') return;
        e.preventDefault();
        openPalette();
        return;
      }
      // dialogs own the keyboard while open; text fields keep their native undo/redo
      if (s.modal.type !== 'none' || s.confirm) return;
      if (isTextEntryTarget(e.target)) {
        // still allow HUD toggle? No, don't steal typing
        return;
      }
      if (!mod) {
        // H toggles metrics HUD (no modifier)
        if (e.key.toLowerCase() === 'h') {
          e.preventDefault();
          s.toggleMetricsHud(s.active);
          return;
        }
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo(s.active);
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        s.redo(s.active);
      } else if (key === 's') {
        e.preventDefault();
        saveProjectFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);
}

/** Drag & drop font and project files anywhere in the window. */
function useFileDrop(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    // dragenter/dragleave fire for every child element; a counter tells when the pointer really left the window
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const projects = files.filter((f) => /\.json$/i.test(f.name));
      const fonts = files.filter((f) => /\.(ttf|otf)$/i.test(f.name));
      if (projects.length === 0 && fonts.length === 0) {
        useStore.getState().toast('warning', 'Drop a .ttf / .otf font or a .pixeel.json project file.');
        return;
      }
      // a project replaces everything; fonts go into the empty workspace first, then the active one
      for (const f of projects.slice(0, 1)) await openProjectFile(f);
      for (const f of fonts) {
        const s = useStore.getState();
        const slot: Slot = !s.fonts.A ? 'A' : !s.fonts.B ? 'B' : s.active;
        await importFontFile(slot, f);
      }
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
  return dragging;
}

/** Auto-save a recovery snapshot shortly after each font change, and flush on the way out. */
function useRecovery() {
  useEffect(() => {
    const snapshot = () => {
      const s = useStore.getState();
      return { fonts: s.fonts, active: s.active, theme: s.theme };
    };
    const unsub = useStore.subscribe((s, prev) => {
      if (s.previewVersion !== prev.previewVersion && (s.fonts.A || s.fonts.B)) {
        scheduleRecoverySave(snapshot());
      }
    });
    const flush = () => {
      const st = useStore.getState();
      if (st.fonts.A || st.fonts.B) {
        cancelScheduledRecoverySave();
        void saveRecoveryNow(snapshot());
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flush();
      const st = useStore.getState();
      if (st.dirty.A || st.dirty.B) {
        // the snapshot keeps the work, but the user may still want to save the project file
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsub();
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // offer recovery once on start-up (only when the snapshot is older than the current page load)
  useEffect(() => {
    let mounted = true;
    void peekRecovery().then((info) => {
      if (mounted && info && Date.now() - info.savedAt > 15_000) useStore.getState().setRecoveryAvailable(info);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // previews live in the document head: release them only when the page goes away
  useEffect(() => {
    window.addEventListener('pagehide', releaseAllPreviews);
    return () => window.removeEventListener('pagehide', releaseAllPreviews);
  }, []);
}

function WorkspaceArea() {
  const active = useStore((s) => s.active);
  const hasA = useStore((s) => s.fonts.A !== null);
  const hasB = useStore((s) => s.fonts.B !== null);
  const hasActive = useStore((s) => s.fonts[active] !== null);
  if (!hasA && !hasB) return <EmptyWorkspace full />;
  if (!hasActive) return <EmptyWorkspace slot={active} />;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: { xs: 'column', lg: 'row' }, overflow: { xs: 'auto', lg: 'hidden' } }}>
      <GlyphBrowser slot={active} />
      <EditorPanel slot={active} />
      <SidePanel slot={active} />
    </Box>
  );
}

export default function App() {
  const theme = useStore((s) => s.theme);
  const muiTheme = useMemo(() => createAppTheme(theme), [theme]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useMemo(() => () => setPaletteOpen(true), []);
  const onboarding = useOnboarding();
  useGlobalShortcuts(openPalette);
  useRecovery();
  const dragging = useFileDrop();

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}>
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <RecoveryBanner />
        <WorkspaceArea />
        <StatusBar />
        <ModalHost />
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
        {onboarding.show && (
          <OnboardingPanel onDismiss={onboarding.dismiss} />
        )}
        <ConfirmDialog />
        <Toasts />
        <BusyOverlay />
        {dragging && (
          <Box
            aria-hidden
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: (t) => t.zIndex.modal + 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              bgcolor: 'rgba(44,108,223,0.12)',
              border: 3,
              borderStyle: 'dashed',
              borderColor: 'secondary.main',
            }}
          >
            <Paper sx={{ px: 4, py: 3, display: 'flex', gap: 2, alignItems: 'center' }}>
              <UploadFileIcon color="secondary" />
              <Typography variant="h6">Drop .ttf / .otf or project files</Typography>
            </Paper>
          </Box>
        )}
      </Box>
    </ThemeProvider>
  );
}

