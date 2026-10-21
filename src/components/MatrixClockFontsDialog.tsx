/**
 * "Load from Matrix Clock (online)…" — pick a font straight from the
 * ESPHome MAX7219 Matrix Clock repository's fonts/ folder (subfolders
 * included) and load it into Font A or Font B. The list is discovered
 * automatically from GitHub, so fonts added to that repository show up
 * here without a Pixeel update.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { importMatrixClockFont } from '../services/fileActions';
import {
  formatMatrixClockFontSize,
  listMatrixClockFonts,
  MATRIX_CLOCK_FONTS_PAGE_URL,
  MATRIX_CLOCK_SITE_URL,
  type MatrixClockOnlineFont,
} from '../services/matrixClockFonts';
import { AppDialog, Hint, SegmentedControl } from './ui';

export function MatrixClockFontsDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const targetFont = useStore((s) => s.fonts);
  const [target, setTarget] = useState<Slot>(props.slot);
  const [fonts, setFonts] = useState<MatrixClockOnlineFont[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadList = useCallback(async (forceRefresh: boolean) => {
    const request = ++requestRef.current;
    setError(null);
    if (forceRefresh) setFonts(null);
    try {
      const list = await listMatrixClockFonts({ forceRefresh });
      if (requestRef.current === request) setFonts(list);
    } catch (err) {
      if (requestRef.current === request) setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadList(false);
  }, [loadList]);

  const filtered = useMemo(() => {
    if (!fonts) return null;
    const q = query.trim().toLowerCase();
    if (!q) return fonts;
    return fonts.filter((f) => f.fileName.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
  }, [fonts, query]);

  // keep the repository's folder structure visible: fonts/ first, then one group per subfolder
  const groups = useMemo(() => {
    if (!filtered) return [];
    const byFolder = new Map<string, MatrixClockOnlineFont[]>();
    for (const font of filtered) {
      const group = byFolder.get(font.folder) ?? [];
      group.push(font);
      byFolder.set(font.folder, group);
    }
    return [...byFolder.entries()].map(([folder, items]) => ({ folder, items }));
  }, [filtered]);

  const load = async (font: MatrixClockOnlineFont) => {
    if (loadingPath) return;
    setLoadingPath(font.path);
    try {
      const ok = await importMatrixClockFont(target, font);
      // a detected pixel font replaces this dialog with the rasterize offer; only close when still ours
      if (ok && useStore.getState().modal.type === 'matrixClockFonts') closeModal();
    } finally {
      setLoadingPath(null);
    }
  };

  const current = targetFont[target];

  return (
    <AppDialog
      title="Load a font from the MAX7219 Matrix Clock"
      onClose={closeModal}
      maxWidth="md"
      actions={
        <>
          <Button startIcon={<RefreshIcon />} onClick={() => void loadList(true)} disabled={fonts === null || !!loadingPath}>
            Refresh list
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeModal}>Close</Button>
        </>
      }
    >
      <Typography variant="body2">
        Fonts are discovered automatically from the{' '}
        <Link href={MATRIX_CLOCK_FONTS_PAGE_URL} target="_blank" rel="noreferrer">
          fonts/ folder of sandro-defender/Esphome-Max7219-Matrix-Clock
        </Link>{' '}
        — including <code>fonts/&lt;name&gt;/</code> subfolders — the same files the{' '}
        <Link href={MATRIX_CLOCK_SITE_URL} target="_blank" rel="noreferrer">
          live Matrix Clock site
        </Link>{' '}
        and the firmware use. The chosen font downloads straight into your browser and opens here; nothing is uploaded. An internet connection is
        required.
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>
          Load into
        </Typography>
        <SegmentedControl
          ariaLabel="Target workspace"
          value={target}
          onChange={(v) => setTarget(v)}
          options={[
            { value: 'A', label: 'Font A' },
            { value: 'B', label: 'Font B' },
          ]}
        />
        <Hint>
          {current
            ? `Font ${target} currently holds “${current.meta.fontFamily}”. You will be asked before unsaved work is replaced.`
            : `Font ${target} is empty.`}
        </Hint>
      </Stack>

      {fonts !== null && fonts.length > 1 && (
        <TextField
          label="Filter fonts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="File or folder name…"
          fullWidth
        />
      )}

      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void loadList(true)}>
              Retry
            </Button>
          }
        >
          {error}
        </Alert>
      )}

      {fonts === null && !error && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }} role="progressbar" aria-label="Looking for fonts in the Matrix Clock repository">
          <CircularProgress size={20} />
          <Typography variant="body2">Looking for fonts in the Matrix Clock repository…</Typography>
        </Stack>
      )}

      {fonts !== null && fonts.length === 0 && (
        <Alert severity="info">
          No font files (.ttf, .otf, .woff, .woff2 or .bdf) were found under fonts/ in the Matrix Clock repository. Fonts committed there — in any
          subfolder — will appear here automatically.
        </Alert>
      )}

      {fonts !== null && fonts.length > 0 && filtered !== null && filtered.length === 0 && (
        <Hint>No font matches “{query.trim()}”.</Hint>
      )}

      {groups.length > 0 && (
        <List aria-label="Matrix Clock fonts" sx={{ border: 1, borderColor: 'divider', borderRadius: 1, py: 0 }}>
          {groups.map((group) => (
            <React.Fragment key={group.folder || '(root)'}>
              <ListSubheader sx={{ fontFamily: 'monospace', lineHeight: 2.2 }}>{group.folder ? `fonts/${group.folder}/` : 'fonts/'}</ListSubheader>
              {group.items.map((font) => {
                const size = formatMatrixClockFontSize(font.sizeBytes);
                const busy = loadingPath === font.path;
                return (
                  <ListItem
                    key={font.path}
                    divider
                    secondaryAction={
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <CloudDownloadIcon />}
                        disabled={!!loadingPath}
                        onClick={() => void load(font)}
                        aria-label={`Load ${font.fileName} into Font ${target}`}
                      >
                        {busy ? 'Loading…' : `Load into ${target}`}
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={font.fileName}
                      secondary={`${font.path}${size ? ` · ${size}` : ''}`}
                      slotProps={{
                        primary: { sx: { fontWeight: 700, wordBreak: 'break-all', pr: 2 } },
                        secondary: { sx: { fontFamily: 'monospace', wordBreak: 'break-all', pr: 2 } },
                      }}
                    />
                  </ListItem>
                );
              })}
            </React.Fragment>
          ))}
        </List>
      )}

      <Hint>
        New fonts committed to the repository's <code>fonts/</code> folder (or a subfolder such as <code>fonts/my-font/</code>) appear in this list
        automatically — press <em>Refresh list</em> to check again. Listing uses the public GitHub API; downloads use the same raw file base as the
        clock firmware (<code>fonts_base_url</code>). Respect each font's license (see the <code>LICENSE.txt</code> next to it in the repository).
      </Hint>
    </AppDialog>
  );
}
