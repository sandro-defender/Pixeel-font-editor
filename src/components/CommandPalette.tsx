/** Command palette: Ctrl/Cmd+K fuzzy search over actions + glyph jump. */
import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography,
  Chip,
  Divider,
  Stack,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveIcon from '@mui/icons-material/Save';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import GridOnIcon from '@mui/icons-material/GridOn';
import AddIcon from '@mui/icons-material/Add';
import DesignServicesIcon from '@mui/icons-material/DesignServices';
import CodeIcon from '@mui/icons-material/Code';
import HelpOutlineIcon from '@mui/icons-material/Help';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import SpaceBarIcon from '@mui/icons-material/SpaceBar';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { saveProjectFile } from '../services/fileActions';
import { charFromCodePoint, describeCodePoint } from '../core/unicodeNames';

export interface Command {
  id: string;
  label: string;
  keywords: string[];
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  group: string;
}

export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().trim();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 50;
  // fuzzy: chars in order
  let qi = 0;
  let ti = 0;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) qi++;
    ti++;
  }
  if (qi === q.length) {
    // bonus for shorter target and early matches
    return 20 + (q.length / t.length) * 10;
  }
  return 0;
}

export function commandScore(query: string, cmd: Command): number {
  const q = query.toLowerCase();
  let best = 0;
  best = Math.max(best, fuzzyScore(q, cmd.label));
  for (const kw of cmd.keywords) {
    best = Math.max(best, fuzzyScore(q, kw));
  }
  return best;
}

function parseGlyphJump(query: string): number | null {
  const s = query.trim();
  if (!s) return null;
  if ([...s].length === 1) {
    return s.codePointAt(0) ?? null;
  }
  const m = s.match(/^(?:u\+|0x)?([0-9a-f]{1,6})$/i);
  if (m) {
    const cp = parseInt(m[1], 16);
    if (cp >= 0 && cp <= 0x10ffff) return cp;
  }
  return null;
}

export function useCommands(): Command[] {
  const fonts = useStore((s) => s.fonts);
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setActive = useStore((s) => s.setActive);
  const openModal = useStore((s) => s.openModal);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const ui = useStore((s) => s.ui[active]);
  const toggleGridLines = useStore((s) => s.toggleGridLines);
  const setListSearch = useStore((s) => s.setListSearch);

  const doc = fonts[active];
  const hasDoc = !!doc;
  const hasGlyph = !!doc && !!ui.glyphId;
  const glyph = hasDoc && hasGlyph ? doc!.glyphs.find((g) => g.id === ui.glyphId) : null;
  const isPixel = !!glyph?.pixel;

  return useMemo(() => {
    const cmds: Command[] = [
      {
        id: 'new-font',
        label: 'New font…',
        keywords: ['create', 'new', 'font', 'pixel', 'led'],
        icon: <NoteAddIcon />,
        group: 'File',
        action: () => openModal({ type: 'newFont' }),
      },
      {
        id: 'open-font',
        label: `Open font into Font ${active}…`,
        keywords: ['open', 'import', 'ttf', 'otf', 'file'],
        icon: <FolderOpenIcon />,
        group: 'File',
        action: () => {
          // dispatch custom event that TopBar listens? fallback to toast + file picker via DOM query
          const el = document.querySelector('input[aria-label=\"Open font file\"]') as HTMLInputElement | null;
          el?.click();
        },
      },
      {
        id: 'open-project',
        label: 'Open project…',
        keywords: ['open', 'project', 'json', 'pixeel'],
        icon: <FolderOpenIcon />,
        group: 'File',
        action: () => {
          const el = document.querySelector('input[aria-label=\"Open project file\"]') as HTMLInputElement | null;
          el?.click();
        },
      },
      {
        id: 'save-project',
        label: 'Save project',
        keywords: ['save', 'project', 'json', 'ctrl+s'],
        icon: <SaveIcon />,
        shortcut: 'Ctrl+S',
        group: 'File',
        action: () => saveProjectFile(),
      },
      {
        id: 'export-ttf',
        label: `Export Font ${active} as TTF…`,
        keywords: ['export', 'ttf', 'download', 'font'],
        icon: <FileDownloadIcon />,
        group: 'File',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'export', slot: active }),
      },
      {
        id: 'font-info',
        label: `Font ${active} info & license…`,
        keywords: ['info', 'metadata', 'license', 'author', 'version', 'copyright'],
        icon: <InfoOutlinedIcon />,
        group: 'Font',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'metadata', slot: active }),
      },
      {
        id: 'led-matrix',
        label: doc?.ledMatrix ? 'LED matrix (on)…' : 'LED matrix…',
        keywords: ['led', 'matrix', 'exact', 'pixels'],
        icon: <LightbulbOutlinedIcon />,
        group: 'Font',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'ledMatrix', slot: active }),
      },
      {
        id: 'kerning',
        label: 'Kerning pairs…',
        keywords: ['kerning', 'kern', 'pairs', 'spacing', 'gpos', 'typography'],
        icon: <SpaceBarIcon />,
        group: 'Font',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'kerning', slot: active, left: hasGlyph ? ui.glyphId! : undefined }),
      },
      {
        id: 'rasterize-font',
        label: 'Convert font to pixel grid…',
        keywords: ['convert', 'pixel', 'rasterize', 'vector', 'grid'],
        icon: <GridOnIcon />,
        group: 'Font',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'rasterize', slot: active, scope: 'font' }),
      },
      {
        id: 'rasterize-glyph',
        label: 'Convert this glyph to pixels',
        keywords: ['convert', 'pixel', 'glyph', 'rasterize'],
        icon: <GridOnIcon />,
        group: 'Glyph',
        disabled: !hasGlyph,
        action: () => hasGlyph && openModal({ type: 'rasterize', slot: active, glyphId: ui.glyphId!, scope: 'glyph' }),
      },
      {
        id: 'add-glyph',
        label: 'Add glyph…',
        keywords: ['add', 'glyph', 'unicode', 'character'],
        icon: <AddIcon />,
        group: 'Glyph',
        disabled: !hasDoc,
        action: () => hasDoc && openModal({ type: 'addGlyph', slot: active }),
      },
      {
        id: 'resize-grid',
        label: 'Resize pixel grid…',
        keywords: ['resize', 'grid', 'pixel', 'dimensions'],
        icon: <ZoomInIcon />,
        group: 'Glyph',
        disabled: !isPixel,
        action: () => hasGlyph && isPixel && openModal({ type: 'resizeGrid', slot: active, glyphId: ui.glyphId! }),
      },
      {
        id: 'pixel-code',
        label: 'Pixel code…',
        keywords: ['pixel', 'code', 'text', 'art', 'led', 'columns'],
        icon: <CodeIcon />,
        group: 'Glyph',
        disabled: !isPixel,
        action: () => hasGlyph && isPixel && openModal({ type: 'pixelCode', slot: active, glyphId: ui.glyphId! }),
      },
      {
        id: 'glyph-designer',
        label: 'Glyph designer…',
        keywords: ['designer', 'reference', 'font', 'georgian', 'style'],
        icon: <DesignServicesIcon />,
        group: 'Glyph',
        disabled: !isPixel,
        action: () => hasGlyph && isPixel && openModal({ type: 'glyphDesigner', slot: active, glyphId: ui.glyphId! }),
      },
      {
        id: 'switch-a',
        label: 'Switch to Font A',
        keywords: ['switch', 'font', 'a', 'workspace'],
        icon: <SwapHorizIcon />,
        group: 'View',
        action: () => setActive('A'),
      },
      {
        id: 'switch-b',
        label: 'Switch to Font B',
        keywords: ['switch', 'font', 'b', 'workspace'],
        icon: <SwapHorizIcon />,
        group: 'View',
        action: () => setActive('B'),
      },
      {
        id: 'toggle-theme',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        keywords: ['theme', 'dark', 'light', 'appearance'],
        icon: <DarkModeOutlinedIcon />,
        group: 'View',
        action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'toggle-grid',
        label: `${ui.showGrid ? 'Hide' : 'Show'} grid lines`,
        keywords: ['grid', 'lines', 'toggle', 'show', 'hide'],
        icon: <GridOnIcon />,
        group: 'View',
        shortcut: 'G',
        action: () => toggleGridLines(active),
      },
      {
        id: 'focus-search',
        label: 'Search glyphs…',
        keywords: ['search', 'glyph', 'find', 'filter'],
        icon: <SearchIcon />,
        group: 'View',
        action: () => {
          const el = document.querySelector(`aside[aria-label=\"Glyph browser for Font ${active}\"] input[aria-label=\"Search glyphs\"]`) as HTMLInputElement | null;
          el?.focus();
        },
      },
      {
        id: 'clear-search',
        label: 'Clear glyph search',
        keywords: ['clear', 'search', 'filter'],
        icon: <SearchIcon />,
        group: 'View',
        action: () => setListSearch(active, ''),
      },
      {
        id: 'undo',
        label: `Undo in Font ${active}`,
        keywords: ['undo', 'ctrl+z', 'history'],
        icon: <UndoIcon />,
        shortcut: 'Ctrl+Z',
        group: 'Edit',
        disabled: past[active].length === 0,
        action: () => undo(active),
      },
      {
        id: 'redo',
        label: `Redo in Font ${active}`,
        keywords: ['redo', 'ctrl+y', 'history'],
        icon: <RedoIcon />,
        shortcut: 'Ctrl+Y',
        group: 'Edit',
        disabled: future[active].length === 0,
        action: () => redo(active),
      },
      {
        id: 'help',
        label: 'Help & shortcuts…',
        keywords: ['help', 'shortcuts', 'keyboard', 'docs'],
        icon: <HelpOutlineIcon />,
        group: 'Help',
        action: () => openModal({ type: 'help' }),
      },
    ];
    return cmds;
  }, [active, doc, hasDoc, hasGlyph, isPixel, openModal, past, future, setActive, setTheme, theme, toggleGridLines, setListSearch, ui.glyphId, ui.showGrid]);
}

export function CommandPalette(props: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commands = useCommands();
  const fonts = useStore((s) => s.fonts);
  const active = useStore((s) => s.active);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const setListSearch = useStore((s) => s.setListSearch);

  const doc = fonts[active];

  // glyph jump candidates
  const jumpCp = useMemo(() => parseGlyphJump(query), [query]);
  const jumpGlyphs = useMemo(() => {
    if (!doc || jumpCp === null) return [];
    const exact = doc.glyphs.filter((g) => g.unicode === jumpCp);
    if (exact.length) return exact;
    // if query is single char, also search by char
    if ([...query.trim()].length === 1) {
      const cp = query.trim().codePointAt(0)!;
      return doc.glyphs.filter((g) => g.unicode === cp);
    }
    return [];
  }, [doc, jumpCp, query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.filter((c) => !c.disabled);
    const scored = commands
      .map((c) => ({ cmd: c, score: commandScore(q, c) }))
      .filter((x) => x.score > 0 && !x.cmd.disabled)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd);
    return scored;
  }, [commands, query]);

  const allItems = useMemo(() => {
    // jump results first
    const jumpItems = jumpGlyphs.map((g) => ({
      type: 'jump' as const,
      glyph: g,
    }));
    const cmdItems = filtered.map((c) => ({
      type: 'cmd' as const,
      cmd: c,
    }));
    return [...jumpItems, ...cmdItems];
  }, [jumpGlyphs, filtered]);

  useEffect(() => {
    if (props.open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [props.open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const execute = (index: number) => {
    const item = allItems[index];
    if (!item) return;
    if (item.type === 'jump') {
      selectGlyph(active, item.glyph.id);
      setListSearch(active, '');
      props.onClose();
    } else {
      props.onClose();
      // small delay so dialog closes before action (avoid focus trap)
      setTimeout(() => item.cmd.action(), 50);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(selectedIndex);
    } else if (e.key === 'Escape') {
      props.onClose();
    }
  };

  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="sm" fullWidth aria-label="Command palette">
      <DialogContent sx={{ p: 0 }}>
        <Box sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            autoFocus
            placeholder="Type a command or a character (e.g. A, U+10D0)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            slotProps={{
              input: {
                startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
              },
            }}
          />
        </Box>
        <List dense sx={{ maxHeight: 380, overflow: 'auto', py: 0 }}>
          {allItems.length === 0 && (
            <ListItem>
              <ListItemText primary="No commands found" secondary={`Try a different search. ${query ? `No glyph for ${query}.` : ''}`} />
            </ListItem>
          )}
          {allItems.map((item, idx) => {
            const selected = idx === selectedIndex;
            if (item.type === 'jump') {
              const g = item.glyph;
              const cp = g.unicode;
              const label = cp !== null ? `${charFromCodePoint(cp)} — ${g.name} (${describeCodePoint(cp)})` : g.name;
              return (
                <ListItem key={`jump-${g.id}`} disablePadding>
                  <ListItemButton selected={selected} onClick={() => execute(idx)} aria-label={`Jump to ${label}`}>
                    <ListItemIcon>
                      <SearchIcon color="primary" />
                    </ListItemIcon>
                    <ListItemText primary={label} secondary="Jump to glyph" />
                    <Chip size="small" label={cp !== null ? `U+${cp.toString(16).toUpperCase()}` : 'unmapped'} />
                  </ListItemButton>
                </ListItem>
              );
            } else {
              const c = item.cmd;
              return (
                <React.Fragment key={c.id}>
                  <ListItem disablePadding>
                    <ListItemButton selected={selected} onClick={() => execute(idx)} disabled={c.disabled}>
                      <ListItemIcon>{c.icon}</ListItemIcon>
                      <ListItemText primary={c.label} secondary={c.group} />
                      {c.shortcut && <Chip size="small" label={c.shortcut} variant="outlined" sx={{ ml: 1 }} />}
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              );
            }
          })}
        </List>
        <Divider />
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {allItems.length} results · ↑↓ navigate · Enter select · Esc close
          </Typography>
          <Stack direction="row" spacing={0.5}>
            <Chip size="small" label="Ctrl+K" variant="outlined" />
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
