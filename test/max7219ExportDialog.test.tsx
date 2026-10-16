// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExportDialog } from '../src/components/dialogs';
import { applyLicense } from '../src/core/license';
import { deriveMetaFields } from '../src/core/metadata';
import type { FontDoc } from '../src/core/types';
import { useStore } from '../src/state/store';
import { drawGlyph, newTestFont } from './helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Digits 5 px wide on the default 8-column grid: "88:88:88" advances 64 px. */
function wideGridFont(): FontDoc {
  let doc = newTestFont(8, 8, 'DialogClock');
  for (const d of '0123456789') {
    doc = drawGlyph(doc, d.codePointAt(0)!, (bm) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 5; x++) bm.set(x, y, 1); }).doc;
  }
  doc = drawGlyph(doc, 0x3a, (bm) => { bm.set(0, 2, 1); bm.set(0, 5, 1); }).doc;
  return {
    ...doc,
    meta: deriveMetaFields(applyLicense({ ...doc.meta, designer: 'Test' }, {
      mode: 'ofl', oflCopyrightHolder: 'Test', oflYear: '2026', oflReservedNames: doc.meta.fontFamily,
    })),
  };
}

describe('MAX7219 export dialog', () => {
  it('shows why validation fails and fills the debug log', async () => {
    useStore.getState().loadFont('A', wideGridFont(), null);
    render(<ExportDialog slot="A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Validate preview' }));

    // the cause and the fix sit right under the checks table…
    expect(await screen.findByText('Why it fails and how to fix it', {}, { timeout: 20000 })).toBeTruthy();
    const notes = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(notes.some((t) => t.startsWith('"88:88:88" is 64 px wide because ESPHome always moves the pen by the full advance width'))).toBe(true);
    expect(notes.some((t) => t.includes("'8' is drawn on a 8-column grid with 5 inked columns"))).toBe(true);
    const widthRow = screen.getByRole('row', { name: /"88:88:88" advance width/ });
    expect(widthRow.textContent).toContain("'8' 8 px (5 ink + 3 blank) ×6");

    // …and the debug log replaces the raw JSON dump
    const log = screen.getByLabelText('MAX7219 debug log') as HTMLTextAreaElement;
    await waitFor(() => expect(log.value.startsWith('===== Pixeel MAX7219 debug log =====')).toBe(true));
    expect(log.value).toContain('--- 8 px on the clock');
    expect(log.value).not.toContain('Raw measurements');
    expect(screen.getByRole('button', { name: 'Copy debug log' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download debug log' })).toBeTruthy();
  }, 60000);
});
