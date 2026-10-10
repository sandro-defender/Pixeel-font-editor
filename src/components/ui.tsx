/** Shared MUI building blocks: dialog shell, confirmation, toasts, busy overlay, segmented controls. */
import React, { useEffect, useId, useState } from 'react';
import {
  Alert,
  Backdrop,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  type DialogProps,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useStore } from '../state/store';

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------
export function AppDialog(props: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  actions?: React.ReactNode;
  maxWidth?: DialogProps['maxWidth'];
}) {
  const titleId = useId();
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth={props.maxWidth ?? 'sm'} aria-labelledby={titleId} scroll="paper">
      <DialogTitle id={titleId} sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>{props.title}</Box>
        <Tooltip title="Close">
          <IconButton aria-label="Close dialog" onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>{props.children}</Stack>
      </DialogContent>
      {props.actions && <DialogActions sx={{ px: 2, py: 1.5, flexWrap: 'wrap', gap: 1 }}>{props.actions}</DialogActions>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Confirmation (driven by store.askConfirm)
// ---------------------------------------------------------------------------
export function ConfirmDialog() {
  const req = useStore((s) => s.confirm);
  const settle = useStore((s) => s.settleConfirm);
  if (!req) return null;
  return (
    <Dialog open onClose={() => settle(false)} aria-labelledby="confirm-title" maxWidth="xs" fullWidth>
      <DialogTitle id="confirm-title">{req.title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{req.message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => settle(false)}>{req.cancelLabel}</Button>
        <Button variant="contained" color={req.danger ? 'error' : 'primary'} onClick={() => settle(true)} autoFocus>
          {req.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts & busy overlay
// ---------------------------------------------------------------------------
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <Stack
      role="status"
      aria-live="polite"
      spacing={1}
      sx={{ position: 'fixed', bottom: 16, right: 16, zIndex: (t) => t.zIndex.snackbar, maxWidth: 440, alignItems: 'flex-end' }}
    >
      {toasts.map((t) => (
        <Alert key={t.id} severity={t.kind} variant="filled" onClose={() => dismiss(t.id)} sx={{ width: '100%', boxShadow: 4, alignItems: 'center' }}>
          {t.text}
        </Alert>
      ))}
    </Stack>
  );
}

export function BusyOverlay() {
  const busy = useStore((s) => s.busy);
  return (
    <Backdrop open={!!busy} sx={{ zIndex: (t) => t.zIndex.modal + 1, color: '#fff', backgroundColor: 'rgba(10,12,20,0.35)' }}>
      {busy && (
        <Paper role="progressbar" aria-label={busy} aria-busy="true" elevation={6} variant="elevation" sx={{ px: 3, py: 2, display: 'flex', gap: 2, alignItems: 'center', color: 'text.primary' }}>
          <CircularProgress size={22} />
          <Typography variant="body2">{busy}</Typography>
        </Paper>
      )}
    </Backdrop>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Segmented choice (exclusive toggle group) that always has one value selected. */
export function SegmentedControl<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string; tip?: string }>;
  onChange: (v: T) => void;
  ariaLabel: string;
  fullWidth?: boolean;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={props.value}
      aria-label={props.ariaLabel}
      fullWidth={props.fullWidth}
      onChange={(_, v: T | null) => {
        if (v !== null && v !== props.value) props.onChange(v);
      }}
      sx={{ flexWrap: 'wrap', '& .MuiToggleButton-root': { textTransform: 'none', px: 1.25 } }}
    >
      {props.options.map((o) => (
        <Tooltip key={o.value} title={o.tip ?? o.label}>
          <ToggleButton value={o.value} aria-label={o.label}>
            {o.label}
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  );
}

/** A titled group of controls inside a panel. */
export function Section(props: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 1.5, bgcolor: 'background.default' }}>
      <Stack spacing={1.5}>
        <Stack sx={{ alignItems: 'center' }} direction="row" spacing={1}>
          <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.8, flex: 1 }}>
            {props.title}
          </Typography>
          {props.action}
        </Stack>
        {props.children}
      </Stack>
    </Paper>
  );
}

/** True when keyboard shortcuts must leave the key alone (user is typing or picking a value). */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable) return true;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"]');
}

/** Track the content-box size of an element (ResizeObserver with a one-off measure fallback). */
export function useElementSize<T extends Element>(ref: React.RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Inline "hint" text used under fields. */
export function Hint(props: { children: React.ReactNode }) {
  return (
    <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.5 }}>
      {props.children}
    </Typography>
  );
}
