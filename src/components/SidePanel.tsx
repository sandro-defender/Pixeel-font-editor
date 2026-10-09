/** Right-hand tabbed panel. */
import React, { useState } from 'react';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { MetricsPanel, PreviewPanel, ComparePanel } from './SidePanels';

export function SidePanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const other = useStore((s) => s.fonts[slot === 'A' ? 'B' : 'A']);
  const [tab, setTab] = useState<'metrics' | 'preview' | 'compare'>('metrics');

  return (
    <aside className="side-pane" aria-label="Font panels">
      <div className="side-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'metrics'} className={`side-tab ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>
          Metrics
        </button>
        <button role="tab" aria-selected={tab === 'preview'} className={`side-tab ${tab === 'preview' ? 'active' : ''}`} onClick={() => setTab('preview')}>
          Preview
        </button>
        <button
          role="tab"
          aria-selected={tab === 'compare'}
          className={`side-tab ${tab === 'compare' ? 'active' : ''}`}
          onClick={() => setTab('compare')}
          title={other ? 'Compare Font A and Font B' : 'Load a second font to compare'}
        >
          Compare
        </button>
      </div>
      <div className="side-body">
        {tab === 'metrics' && <MetricsPanel slot={slot} />}
        {tab === 'preview' && doc && <PreviewPanel slot={slot} />}
        {tab === 'preview' && !doc && <div className="muted small">Load a font to preview it.</div>}
        {tab === 'compare' && <ComparePanel />}
      </div>
    </aside>
  );
}
