/** Right-hand tabbed panel. */
import React, { useState } from 'react';
import { Box, Paper, Tab, Tabs } from '@mui/material';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { MetricsPanel, PreviewPanel, ComparePanel } from './SidePanels';

type PanelTab = 'metrics' | 'preview' | 'compare';

export function SidePanel(props: { slot: Slot }) {
  const { slot } = props;
  const other = useStore((s) => s.fonts[slot === 'A' ? 'B' : 'A']);
  const [tab, setTab] = useState<PanelTab>('metrics');

  return (
    <Paper
      component="aside"
      aria-label="Font panels"
      square
      sx={{
        width: { xs: '100%', lg: 340, xl: 380 },
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        borderWidth: 0,
        borderLeft: { lg: 1 },
        borderTop: { xs: 1, lg: 0 },
        borderColor: 'divider',
      }}
    >
      <Tabs
        value={tab}
        onChange={(_, v: PanelTab) => setTab(v)}
        variant="fullWidth"
        aria-label="Side panels"
        sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 44 }}
      >
        <Tab value="metrics" label="Metrics" id="side-tab-metrics" aria-controls="side-panel-metrics" />
        <Tab value="preview" label="Preview" id="side-tab-preview" aria-controls="side-panel-preview" />
        <Tab
          value="compare"
          label="Compare"
          id="side-tab-compare"
          aria-controls="side-panel-compare"
          title={other ? 'Compare Font A and Font B' : 'Load a second font to compare'}
        />
      </Tabs>
      <Box
        role="tabpanel"
        id={`side-panel-${tab}`}
        aria-labelledby={`side-tab-${tab}`}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}
      >
        {tab === 'metrics' && <MetricsPanel slot={slot} />}
        {tab === 'preview' && <PreviewPanel slot={slot} />}
        {tab === 'compare' && <ComparePanel />}
      </Box>
    </Paper>
  );
}
