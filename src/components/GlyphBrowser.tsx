/** Searchable glyph grid with previews, unicode values and selection. */
import React, { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../state/store';
import type { GlyphDoc, Slot } from '../core/types';
import { charFromCodePoint, describeCodePoint, unicodeName } from '../core/unicodeNames';
import { renderGlyphCard } from '../render/glyphRender';
import { Btn, SegBtns } from './ui';
import { basicSetGlyphs } from '../core/fontFactory';

function parseSearch(q: string): (g: GlyphDoc) => boolean {
  const s = q.trim();
  if (!s) return () => true;
  // single character search
  if ([...s].length === 1) {
    const cp = s.codePointAt(0)!;
    return (g) => g.unicode === cp;
  }
  const hex = s.match(/^(?:u\+|0x)?([0-9a-f]{1,6})$/i);
  if (hex) {
    const cp = parseInt(hex[1], 16);
    return (g) => g.unicode === cp;
  }
  const lower = s.toLowerCase();
  return (g) => {
    if (g.name.toLowerCase().includes(lower)) return true;
    if (g.unicode !== null) {
      const name = unicodeName(g.unicode);
      if (name?.toLowerCase().includes(lower)) return true;
      if (describeCodePoint(g.unicode).toLowerCase().includes(lower)) return true;
    }
    return false;
  };
}

function GlyphCard(props: { slot: Slot; glyph: GlyphDoc; selected: boolean; multiSelected: boolean; previewVersion: number }) {
  const { glyph, selected, multiSelected, slot } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const toggleMulti = useStore((s) => s.toggleMultiSelect);
  const metrics = useStore((s) => s.fonts[slot]!.metrics);
  const theme = useStore((s) => s.theme);

  useEffect(() => {
    if (!canvasRef.current) return;
    const color = theme === 'dark' ? '#e8eaf2' : '#1c2030';
    renderGlyphCard(canvasRef.current, glyph, metrics, color);
  }, [glyph, metrics, theme, props.previewVersion]);

  const label =
    glyph.unicode !== null
      ? `${charFromCodePoint(glyph.unicode)} · U+${glyph.unicode.toString(16).toUpperCase().padStart(4, '0')}`
      : glyph.name;
  const title =
    glyph.unicode !== null
      ? `${glyph.name} — ${describeCodePoint(glyph.unicode)}`
      : `${glyph.name} — no Unicode assignment`;

  return (
    <div
      className={`glyph-card ${selected ? 'selected' : ''} ${glyph.unicode === null ? 'unmapped' : ''}`}
      title={title}
      onClick={(e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) toggleMulti(slot, glyph.id);
        else selectGlyph(slot, glyph.id);
      }}
      role="button"
      aria-pressed={selected}
      aria-label={title}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectGlyph(slot, glyph.id);
        }
      }}
    >
      {multiSelected && <input className="gc-check" type="checkbox" checked readOnly aria-hidden tabIndex={-1} />}
      {glyph.kind === 'compound' && <span className="badge gray" title="Composite glyph">C</span>}
      {glyph.edited && <span className="badge" title="Edited">✎</span>}
      <canvas ref={canvasRef} />
      <span className="gc-label">{label}</span>
    </div>
  );
}

export function GlyphBrowser(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const ui = useStore((s) => s.ui[slot]);
  const previewVersion = useStore((s) => s.previewVersion);
  const setListSearch = useStore((s) => s.setListSearch);
  const setListFilter = useStore((s) => s.setListFilter);
  const openModal = useStore((s) => s.openModal);
  const setMultiSelect = useStore((s) => s.setMultiSelect);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);

  const addBasicSet = () => {
    if (!doc) return;
    const glyphs = basicSetGlyphs(doc);
    if (glyphs.length === 0) {
      toast('info', 'All basic Latin, digit, punctuation and Georgian glyphs already exist.');
      return;
    }
    commit(slot, 'Add basic set', (d) => ({ ...d, glyphs: [...d.glyphs, ...glyphs] }));
    toast('success', `Added ${glyphs.length} starter glyphs (Latin, digits, punctuation, Georgian).`);
  };

  const glyphs = useMemo(() => {
    if (!doc) return [];
    const match = parseSearch(ui.glyphListSearch);
    return doc.glyphs.filter((g) => {
      if (!match(g)) return false;
      switch (ui.glyphListFilter) {
        case 'mapped': return g.unicode !== null;
        case 'unmapped': return g.unicode === null;
        case 'edited': return g.edited;
        default: return true;
      }
    });
  }, [doc, ui.glyphListSearch, ui.glyphListFilter]);

  if (!doc) return null;

  return (
    <aside className="glyph-pane" aria-label={`Glyph browser for ${slot === 'A' ? 'Font A' : 'Font B'}`}>
      <div className="pane-head">
        <div className="row">
          <input
            className="search"
            placeholder="Search char, U+10D0, name…"
            value={ui.glyphListSearch}
            onChange={(e) => setListSearch(slot, e.target.value)}
            aria-label="Search glyphs"
          />
          <Btn kind="primary" tip="Create a new glyph" onClick={() => openModal({ type: 'addGlyph', slot })}>＋ Glyph</Btn>
          <Btn tip="Add empty glyphs for basic Latin, digits, punctuation and Georgian Mkhedruli" onClick={addBasicSet}>Aa+</Btn>
        </div>
        <div className="row">
          <SegBtns
            ariaLabel="Filter glyphs"
            value={ui.glyphListFilter}
            options={[
              { v: 'all', label: 'All' },
              { v: 'mapped', label: 'Mapped', tip: 'Glyphs with a Unicode assignment' },
              { v: 'unmapped', label: 'Unmapped', tip: 'Glyphs without a Unicode assignment' },
              { v: 'edited', label: 'Edited', tip: 'Glyphs you changed' },
            ]}
            onChange={(v) => setListFilter(slot, v)}
          />
          {ui.multiSelected.length > 0 && (
            <>
              <span className="small muted">{ui.multiSelected.length} selected</span>
              <Btn tip="Clear selection" onClick={() => setMultiSelect(slot, [])}>✕</Btn>
              <Btn kind="primary" tip="Copy the selected glyphs to the other font" onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: ui.multiSelected })}>
                Transfer →{slot === 'A' ? 'B' : 'A'}
              </Btn>
            </>
          )}
        </div>
      </div>
      <div className="glyph-grid" role="listbox" aria-label="Glyphs">
        {glyphs.map((g) => (
          <GlyphCard
            key={g.id}
            slot={slot}
            glyph={g}
            selected={ui.glyphId === g.id}
            multiSelected={ui.multiSelected.includes(g.id)}
            previewVersion={previewVersion}
          />
        ))}
        {glyphs.length === 0 && <div className="muted small" style={{ gridColumn: '1/-1', textAlign: 'center', padding: 20 }}>No glyphs match. Use “＋ Glyph” to create one.</div>}
      </div>
    </aside>
  );
}
