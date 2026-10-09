/** Main editor: picks pixel vs outline mode for the selected glyph. */
import React, { useState } from 'react';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { PixelEditor } from './PixelEditor';
import { OutlineEditor } from './OutlineEditor';
import { Btn } from './ui';
import { flattenedGlyph } from '../core/fontCodec';
import { rasterizeContours, defaultRasterizeFrame } from '../core/rasterize';

export function EditorPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const ui = useStore((s) => s.ui[slot]);
  const commit = useStore((s) => s.commit);
  const openModal = useStore((s) => s.openModal);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<'pixel' | 'outline' | null>(null);

  if (!doc) return null;
  const glyph = doc.glyphs.find((g) => g.id === ui.glyphId);
  if (!glyph) {
    return (
      <section className="editor-pane">
        <div className="dropzone" style={{ border: 'none', background: 'transparent' }}>
          <p className="muted">Select a glyph on the left to start editing, or create a new one.</p>
        </div>
      </section>
    );
  }

  const effectiveMode: 'pixel' | 'outline' =
    mode ?? (glyph.pixel ? 'pixel' : glyph.contours.length || glyph.kind === 'vector' || glyph.kind === 'compound' ? 'outline' : glyph.kind === 'empty' ? (doc.source?.format === 'created' ? 'pixel' : 'outline') : 'pixel');

  const flatten = () => {
    commit(slot, 'Flatten composite', (d) => {
      const g = d.glyphs.find((x) => x.id === glyph.id)!;
      const flat = flattenedGlyph(g, d.glyphs);
      return { ...d, glyphs: d.glyphs.map((x) => (x.id === g.id ? flat : x)) };
    });
    toast('success', `"${glyph.name}" converted to editable outlines.`);
    setMode('outline');
  };

  return (
    <section className="editor-pane" aria-label="Glyph editor">
      <div className="editor-toolbar" style={{ borderBottom: 'none', paddingBottom: 0 }}>
        <strong>{glyph.unicode !== null ? String.fromCodePoint(glyph.unicode) : '—'} {glyph.name}</strong>
        <span className="chip">{glyph.kind}</span>
        {glyph.edited && <span className="chip">edited</span>}
        <span className="spacer" />
        {glyph.pixel && (
          <Btn kind={effectiveMode === 'pixel' ? 'primary' : 'default'} onClick={() => setMode('pixel')} tip="Edit the pixel grid">
            ▦ Pixels
          </Btn>
        )}
        {(glyph.contours.length > 0 || glyph.kind === 'vector' || glyph.kind === 'compound' || glyph.sourceContours) && (
          <Btn kind={effectiveMode === 'outline' ? 'primary' : 'default'} onClick={() => setMode('outline')} tip="Edit vector contours">
            ✒ Outline
          </Btn>
        )}
        {glyph.kind === 'compound' && (
          <Btn kind="danger" tip="Composite glyphs reference other glyphs; flatten to edit the outlines directly" onClick={flatten}>
            Flatten composite…
          </Btn>
        )}
        {!glyph.pixel && (glyph.kind === 'vector' || glyph.kind === 'compound' || glyph.contours.length > 0) && (
          <Btn tip="Rasterize this vector glyph into an editable pixel grid" onClick={() => openModal({ type: 'rasterize', slot, glyphId: glyph.id })}>
            Convert to pixels…
          </Btn>
        )}
      </div>

      {effectiveMode === 'pixel' && glyph.pixel ? (
        <PixelEditor slot={slot} glyph={glyph} />
      ) : effectiveMode === 'outline' && (glyph.contours.length > 0 || glyph.kind === 'vector') ? (
        <OutlineEditor slot={slot} glyph={glyph} />
      ) : (
        <div className="editor-body">
          <p className="muted">
            This glyph has no outline data yet.{' '}
            {glyph.pixel ? (
              <Btn onClick={() => setMode('pixel')}>Edit pixels</Btn>
            ) : (
              <Btn onClick={() => openModal({ type: 'rasterize', slot, glyphId: glyph.id })}>Create a pixel grid…</Btn>
            )}
          </p>
        </div>
      )}
    </section>
  );
}

export { rasterizeContours, defaultRasterizeFrame };
