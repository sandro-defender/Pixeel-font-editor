/** First-run onboarding checklist, stored in localStorage. */
import React, { useEffect, useState } from 'react';
import { Box, Button, Paper, Stack, Typography, Stepper, Step, StepLabel, StepContent, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import { useStore } from '../state/store';

const STORAGE_KEY = 'pixeel-onboarding-dismissed';
const STORAGE_VERSION = 'v2'; // bump to re-show after major updates

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    return data.version === STORAGE_VERSION && data.dismissed === true;
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, dismissed: true, at: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function useOnboarding(): { show: boolean; dismiss: () => void; reset: () => void } {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!isDismissed()) {
      // show after a short delay so app loads first
      const t = setTimeout(() => setShow(true), 800);
      return () => clearTimeout(t);
    }
  }, []);
  const dismiss = () => {
    setDismissed();
    setShow(false);
  };
  const reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setShow(true);
  };
  return { show, dismiss, reset };
}

export function OnboardingPanel(props: { onDismiss: () => void }) {
  const openModal = useStore((s) => s.openModal);
  const fonts = useStore((s) => s.fonts);
  const hasFont = !!fonts.A || !!fonts.B;
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      label: 'Create or open a font',
      description: 'Start with File → New font (choose Standard or LED matrix) or drop a .ttf/.otf file anywhere.',
      done: hasFont,
      action: () => openModal({ type: 'newFont' }),
      actionLabel: 'New font…',
    },
    {
      label: 'Add glyphs',
      description: 'Use Glyph + button, Aa+ for Latin starter set, or ქ+ for full Georgian. Search by character or U+ code.',
      done: (fonts.A?.glyphs.length ?? 0) > 1 || (fonts.B?.glyphs.length ?? 0) > 1,
      action: () => {
        const slot = fonts.A ? 'A' : 'B';
        if (fonts[slot as 'A' | 'B']) openModal({ type: 'addGlyph', slot: slot as 'A' | 'B' });
      },
      actionLabel: 'Add glyph…',
    },
    {
      label: 'Draw pixels',
      description: 'Pick pencil, eraser, fill, line, rect, select. Arrows move cursor, Space paints, H shows metrics HUD, G toggles grid, Ctrl+K opens command palette.',
      done: false,
      action: () => {},
      actionLabel: 'Try Ctrl+K',
    },
    {
      label: 'Export TTF',
      description: 'Export → TTF gives a valid font. ESPHome package .zip gives ready-to-flash files for microcontrollers.',
      done: false,
      action: () => {
        if (hasFont) openModal({ type: 'export', slot: fonts.A ? 'A' : 'B' });
      },
      actionLabel: 'Export…',
    },
  ];

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 5,
        p: 2,
        maxWidth: 380,
        bgcolor: 'background.paper',
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <LightbulbIcon color="primary" />
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Welcome to Pixeel
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label="Onboarding" variant="outlined" />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Quick start — everything runs in your browser, fonts never leave your device.
        </Typography>
        <Stepper activeStep={activeStep} orientation="vertical">
          {steps.map((step, index) => (
            <Step key={step.label} completed={step.done}>
              <StepLabel
                onClick={() => setActiveStep(index)}
                optional={step.done ? <Chip icon={<CheckCircleIcon />} size="small" label="done" color="success" variant="outlined" sx={{ height: 18 }} /> : undefined}
                sx={{ cursor: 'pointer' }}
              >
                {step.label}
              </StepLabel>
              <StepContent>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {step.description}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" variant="contained" onClick={step.action} disabled={step.label === 'Draw pixels'}>
                    {step.actionLabel}
                  </Button>
                  <Button size="small" onClick={() => setActiveStep((s) => Math.min(s + 1, steps.length - 1))}>
                    Next
                  </Button>
                </Stack>
              </StepContent>
            </Step>
          ))}
        </Stepper>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button size="small" onClick={props.onDismiss}>
            Dismiss
          </Button>
          <Button size="small" variant="outlined" onClick={() => openModal({ type: 'help' })}>
            Help & shortcuts
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
