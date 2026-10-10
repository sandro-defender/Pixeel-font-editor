/** App header: brand, workspace tabs (Font A / Font B), file & font menus, undo/redo and theme. */
import React, { useRef, useState } from 'react';
import { AppBar, Badge, Box, Button, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Tab, Tabs, Toolbar, Tooltip, Typography } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import SaveIcon from '@mui/icons-material/Save';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import HelpOutlineIcon from '@mui/icons-material/Help';
import { useStore, workspaceName } from '../state/store';
import type { Slot } from '../core/types';
import { importFontFile, openProjectFile, saveProjectFile } from '../services/fileActions';
import { dragFromOther, readGlyphDrag } from './glyphDrag';

function Brand() {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center',  mr: 1.5, userSelect: 'none' }} title="Pixeel — browser TTF font editor">
      <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 7px)', gap: '1px' }}>
        <Box sx={{ width: 7, height: 7, borderRadius: '1px', bgcolor: 'primary.main' }} />
        <Box sx={{ width: 7, height: 7, borderRadius: '1px', bgcolor: 'secondary.main' }} />
        <Box sx={{ width: 7, height: 7, borderRadius: '1px', bgcolor: 'secondary.main' }} />
        <Box sx={{ width: 7, height: 7, borderRadius: '1px', bgcolor: 'primary.main' }} />
      </Box>
      <Typography variant="h6" component="span" sx={{ fontWeight: 800, letterSpacing: 0.5, fontSize: 18 }}>
        Pixeel
      </Typography>
    </Stack>
  );
}

function WorkspaceTabs() {
  const fonts = useStore((s) => s.fonts);
  const fileNames = useStore((s) => s.fileNames);
  const active = useStore((s) => s.active);
  const dirty = useStore((s) => s.dirty);
  const setActive = useStore((s) => s.setActive);
  const openModal = useStore((s) => s.openModal);
  const [dropSlot, setDropSlot] = useState<Slot | null>(null);

  const tab = (slot: Slot) => {
    const doc = fonts[slot];
    const label = doc ? fileNames[slot] ?? doc.meta.fontFamily : 'empty';
    return (
      <Tab
        key={slot}
        value={slot}
        aria-label={`${workspaceName(slot)}: ${doc ? doc.meta.fontFamily : 'empty'}${dirty[slot] ? ', unsaved changes' : ''}`}
        onDragOver={(e: React.DragEvent) => {
          // glyph cards dragged from the other font can be dropped here to copy them
          if (dragFromOther(e.dataTransfer, slot)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (dropSlot !== slot) setDropSlot(slot);
          }
        }}
        onDragLeave={() => setDropSlot((cur) => (cur === slot ? null : cur))}
        onDrop={(e: React.DragEvent) => {
          const from = dragFromOther(e.dataTransfer, slot);
          setDropSlot(null);
          if (!from) return;
          e.preventDefault();
          e.stopPropagation();
          const ids = readGlyphDrag(e.dataTransfer, from);
          if (ids && ids.length) openModal({ type: 'transfer', from, glyphIds: ids, mode: 'copy' });
        }}
        sx={{
          alignItems: 'flex-start',
          textAlign: 'left',
          minWidth: 160,
          outline: dropSlot === slot ? '2px dashed' : 'none',
          outlineColor: 'primary.main',
          outlineOffset: -2,
          bgcolor: dropSlot === slot ? 'action.hover' : undefined,
        }}
        label={
          <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
            <Badge color="warning" variant="dot" invisible={!(doc && dirty[slot])} sx={{ pr: doc && dirty[slot] ? 1.5 : 0 }}>
              <Typography component="span" sx={{ fontWeight: 700, fontSize: 13, lineHeight: 1.3 }}>
                {workspaceName(slot)}
              </Typography>
            </Badge>
            <Typography variant="caption" color="text.secondary" noWrap component="span" sx={{ display: 'block', maxWidth: 200 }}>
              {label}
            </Typography>
          </Box>
        }
      />
    );
  };

  return (
    <Tabs
      value={active}
      onChange={(_, v: Slot) => setActive(v)}
      aria-label="Font workspaces"
      variant="standard"
      sx={{ minHeight: 48, '& .MuiTabs-indicator': { height: 3 } }}
    >
      {tab('A')}
      {tab('B')}
    </Tabs>
  );
}

function MenuButton(props: { label: string; icon: React.ReactNode; children: (close: () => void) => React.ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button color="inherit" startIcon={props.icon} endIcon={<ArrowDropDownIcon />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu" aria-expanded={!!anchor}>
        {props.label}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 260 } } }}>
        {props.children(() => setAnchor(null))}
      </Menu>
    </>
  );
}

export function TopBar() {
  const fonts = useStore((s) => s.fonts);
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const openModal = useStore((s) => s.openModal);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past[s.active].length > 0);
  const canRedo = useStore((s) => s.future[s.active].length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const doc = fonts[active];

  return (
    <AppBar position="static" color="inherit" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', backgroundImage: 'none' }}>
      <Toolbar variant="dense" sx={{ gap: 1, flexWrap: 'wrap', py: 0.5, minHeight: 56 }}>
        <Brand />
        <WorkspaceTabs />
        <Box sx={{ flex: 1 }} />

        <MenuButton label="File" icon={<FolderOpenIcon />}>
          {(close) => [
            <MenuItem key="new" onClick={() => { close(); openModal({ type: 'newFont' }); }}>
              <ListItemIcon><NoteAddIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="New font…" secondary="Pixel grid or LED matrix" />
            </MenuItem>,
            <MenuItem key="open" onClick={() => { close(); fileInputRef.current?.click(); }}>
              <ListItemIcon><FolderOpenIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Open font (.ttf / .otf)" secondary={`Into Font ${active}`} />
            </MenuItem>,
            <MenuItem key="proj" onClick={() => { close(); projectInputRef.current?.click(); }}>
              <ListItemIcon><FolderOpenIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Open project…" secondary="Both fonts (.pixeel.json)" />
            </MenuItem>,
            <Divider key="d1" />,
            <MenuItem key="save" onClick={() => { close(); saveProjectFile(); }}>
              <ListItemIcon><SaveIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Save project" secondary="Ctrl+S" />
            </MenuItem>,
          ]}
        </MenuButton>

        <MenuButton label="Font" icon={<InfoOutlinedIcon />}>
          {(close) => [
            <MenuItem key="info" disabled={!doc} onClick={() => { close(); openModal({ type: 'metadata', slot: active }); }}>
              <ListItemIcon><InfoOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary="Info & license…" />
            </MenuItem>,
            <MenuItem key="led" disabled={!doc} onClick={() => { close(); openModal({ type: 'ledMatrix', slot: active }); }}>
              <ListItemIcon><LightbulbOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={doc?.ledMatrix ? 'LED matrix (on)…' : 'LED matrix…'} secondary="Exact-pixel mode" />
            </MenuItem>,
          ]}
        </MenuButton>

        <Button
          variant="contained"
          color="primary"
          startIcon={<FileDownloadIcon />}
          disabled={!doc}
          onClick={() => openModal({ type: 'export', slot: active })}
          title="Export the active font as a validated .ttf"
        >
          Export TTF
        </Button>

        <Box sx={{ width: 1, height: 24, bgcolor: 'divider', mx: 0.5 }} />

        <Tooltip title={`Undo in ${workspaceName(active)} (Ctrl+Z)`}>
          <span>
            <IconButton aria-label="Undo" disabled={!canUndo} onClick={() => undo(active)}>
              <UndoIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={`Redo in ${workspaceName(active)} (Ctrl+Y)`}>
          <span>
            <IconButton aria-label="Redo" disabled={!canRedo} onClick={() => redo(active)}>
              <RedoIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          <IconButton aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
          </IconButton>
        </Tooltip>
        <Tooltip title="Help & keyboard shortcuts">
          <IconButton aria-label="Help" onClick={() => openModal({ type: 'help' })}>
            <HelpOutlineIcon />
          </IconButton>
        </Tooltip>

        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,font/ttf"
          hidden
          aria-label="Open font file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFontFile(useStore.getState().active, f);
            e.target.value = '';
          }}
        />
        <input
          ref={projectInputRef}
          type="file"
          accept=".json,.pixeel.json,application/json"
          hidden
          aria-label="Open project file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openProjectFile(f);
            e.target.value = '';
          }}
        />
      </Toolbar>
    </AppBar>
  );
}
