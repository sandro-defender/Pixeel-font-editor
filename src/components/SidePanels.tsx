/** Right-hand panels: metrics & tools, live preview, A/B comparison. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Slot } from '../core/types';
import { parseCodePointInput, describeCodePoint, SAMPLE_TEXTS } from '../core/unicodeNames';
import { drawGlyph } from '../render/glyphRender';
import { rebuildPreview, previewFamily } from '../services/previewFont';
import { assignUnicode, duplicateGlyph, removeGlyphs, renameGlyph, setAdvance, setLeftSideBearing } from '../state/glyphActions';
import { Btn, Field } from './ui';

// ---------------------------------------------------------------------------
// Metrics & tools
// ---------------------------------------------------------------------------
export function MetricsPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const ui = useStore((s) => s.ui[slot]);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const openModal = useStore((s) => s.openModal);

  const glyph = doc?.glyphs.find((g) => g.id === ui.glyphId);
  const [uniInput, setUniInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [advInput, setAdvInput] = useState('');
  const [lsbInput, setLsbInput] = useState('');

  useEffect(() => {
    if (glyph) {
      setUniInput(glyph.unicode !== null ? 'U+' + glyph.unicode.toString(16).toUpperCase() : '');
      setNameInput(glyph.name);
      setAdvInput(String(glyph.advanceWidth));
      setLsbInput(String(glyph.leftSideBearing));
    }
  }, [glyph?.id, glyph?.unicode, glyph?.advanceWidth, glyph?.leftSideBearing]);

  if (!doc || !glyph) return <div className="muted small">No glyph selected.</div>;

  const applyUnicode = () => {
    const raw = uniInput.trim();
    const cp = raw === '' ? null : parseCodePointInput(raw);
    if (raw !== '' && cp === null) {
      toast('error', `"${raw}" is not a valid character or code point.`);
      return;
    }
    try {
      commit(slot, 'Assign Unicode', (d) => assignUnicode(d, glyph.id, cp));
      toast('success', cp === null ? 'Unicode assignment removed.' : `Assigned ${describeCodePoint(cp)}.`);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  const applyName = () => {
    if (nameInput === glyph.name) return;
    try {
      commit(slot, 'Rename glyph', (d) => renameGlyph(d, glyph.id, nameInput));
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
      setNameInput(glyph.name);
    }
  };

  const applyMetrics = () => {
    const adv = Number(advInput);
    const lsb = Number(lsbInput);
    try {
      if (!Number.isNaN(adv) && adv !== glyph.advanceWidth) {
        commit(slot, 'Set advance', (d) => setAdvance(d, glyph.id, adv));
      }
      if (!Number.isNaN(lsb) && lsb !== glyph.leftSideBearing) {
        commit(slot, 'Set LSB', (d) => setLeftSideBearing(d, glyph.id, lsb));
        toast('info', 'Glyph content was shifted to match the new left side bearing.');
      }
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel-section">
      <h3>Glyph metrics & tools</h3>
      <Field label="Unicode assignment" hint="Character, U+10D0, 0x41 or 65. Empty removes the mapping.">
        <div className="row">
          <input value={uniInput} onChange={(e) => setUniInput(e.target.value)} placeholder="e.g. U+0041" aria-label="Unicode value" onKeyDown={(e) => e.key === 'Enter' && applyUnicode()} />
          <Btn onClick={applyUnicode} tip="Apply the Unicode assignment (validated for conflicts)">Apply</Btn>
        </div>
      </Field>
      {glyph.unicode !== null && <div className="hint">{describeCodePoint(glyph.unicode)}</div>}
      {glyph.name === '.notdef' && <div className="hint">.notdef is required and stays unmapped.</div>}
      <Field label="Glyph name">
        <div className="row">
          <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} onBlur={applyName} onKeyDown={(e) => e.key === 'Enter' && applyName()} aria-label="Glyph name" />
        </div>
      </Field>
      <div className="grid2">
        <Field label="Advance width" hint="Font units">
          <input type="number" value={advInput} onChange={(e) => setAdvInput(e.target.value)} aria-label="Advance width" />
        </Field>
        <Field label="Left side bearing" hint="Shifts glyph content">
          <input type="number" value={lsbInput} onChange={(e) => setLsbInput(e.target.value)} aria-label="Left side bearing" />
        </Field>
      </div>
      <div className="row">
        <Btn kind="primary" onClick={applyMetrics} tip="Apply advance width and side bearing">Apply metrics</Btn>
        <Btn
          tip="Duplicate this glyph (the copy is unmapped)"
          onClick={() => {
            commit(slot, 'Duplicate glyph', (d) => duplicateGlyph(d, glyph.id).doc);
            toast('success', 'Glyph duplicated (copy is unmapped).');
          }}
        >
          ⧉ Duplicate
        </Btn>
        {glyph.name !== '.notdef' && (
          <Btn
            kind="danger"
            tip="Delete this glyph"
            onClick={() => {
              if (!window.confirm(`Delete glyph "${glyph.name}"? This can be undone with Ctrl+Z.`)) return;
              commit(slot, 'Delete glyph', (d) => removeGlyphs(d, [glyph.id]));
              selectGlyph(slot, doc.glyphs.find((g) => g.id !== glyph.id)?.id ?? null);
            }}
          >
            🗑 Delete
          </Btn>
        )}
      </div>
      {glyph.kind === 'compound' && (
        <div className="warning-box">
          Composite glyph — it references other glyphs. Flattening (button in the editor toolbar) converts it to editable outlines. It is preserved as a composite on export while unedited.
        </div>
      )}
      <div className="row small muted">
        {glyph.instructions ? <span className="chip">hinting instructions</span> : null}
        {glyph.sourceContours ? <span className="chip">source outline kept</span> : null}
        {glyph.srcIndex !== null ? <span className="chip">source #{glyph.srcIndex}</span> : null}
      </div>
      <div className="row">
        <Btn onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: [glyph.id], mode: 'copy' })} tip="Copy this glyph to the other font">
          Copy to {slot === 'A' ? 'Font B' : 'Font A'}…
        </Btn>
        <Btn onClick={() => openModal({ type: 'transfer', from: slot, glyphIds: [glyph.id], mode: 'move' })} tip="Move this glyph to the other font (removes it here; one undo restores both)">
          Move to {slot === 'A' ? 'Font B' : 'Font A'}…
        </Btn>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live preview (uses the current edited font incl. unsaved changes)
// ---------------------------------------------------------------------------
export function PreviewPanel(props: { slot: Slot }) {
  const { slot } = props;
  const doc = useStore((s) => s.fonts[slot]);
  const previewVersion = useStore((s) => s.previewVersion);
  const [text, setText] = useState(SAMPLE_TEXTS.Mixed);
  const [size, setSize] = useState(42);
  const [spacing, setSpacing] = useState(0);
  const [family, setFamily] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'building' | 'error'>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!doc) {
      setFamily(null);
      return;
    }
    setStatus('building');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      rebuildPreview(slot, doc)
        .then((f) => {
          setFamily(f);
          setStatus('idle');
        })
        .catch(() => setStatus('error'));
    }, 650);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.fontId, previewVersion, slot]);

  if (!doc) return <div className="muted small">Load a font to preview it.</div>;

  return (
    <div className="panel-section">
      <h3>Live preview {status === 'building' && <span className="muted small">(rebuilding font…)</span>}{status === 'error' && <span className="small" style={{ color: 'var(--err)' }}> (preview build failed)</span>}</h3>
      <Field label="Sample text">
        <textarea value={text} onChange={(e) => setText(e.target.value)} aria-label="Preview text" />
      </Field>
      <div className="row small">
        {Object.entries(SAMPLE_TEXTS).map(([k, v]) => (
          <Btn key={k} kind="ghost" tip={v} onClick={() => setText((t) => (t.includes(v) ? t : t + '\n' + v))}>
            + {k}
          </Btn>
        ))}
      </div>
      <div className="grid2">
        <Field label={`Font size — ${size}px`}>
          <input type="range" min={10} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Preview font size" />
        </Field>
        <Field label={`Letter spacing — ${spacing / 100}em`}>
          <input type="range" min={-5} max={40} value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} aria-label="Preview letter spacing" />
        </Field>
      </div>
      <div
        className="preview-text"
        style={{
          fontFamily: family ? `"${family}"` : 'serif',
          fontSize: size,
          letterSpacing: `${spacing / 100}em`,
          lineHeight: 1.25,
          opacity: family ? 1 : 0.4,
        }}
        aria-label="Font preview"
      >
        {text || 'Type something…'}
      </div>
      <div className="hint">Preview reflects unsaved edits. Rebuilt in a background worker after each change.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A/B comparison
// ---------------------------------------------------------------------------
export function ComparePanel() {
  const docA = useStore((s) => s.fonts.A);
  const docB = useStore((s) => s.fonts.B);
  const openModal = useStore((s) => s.openModal);
  const [char, setChar] = useState<string>('A');
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);

  const cp = useMemo(() => char.codePointAt(0) ?? null, [char]);

  useEffect(() => {
    const render = (canvas: HTMLCanvasElement | null, doc: typeof docA) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = 150 * dpr;
      canvas.height = 150 * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 150, 150);
      if (!doc || cp === null) return;
      const glyph = doc.glyphs.find((g) => g.unicode === cp);
      const color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
      if (!glyph) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim').trim() || '#888';
        ctx.font = '12px system-ui';
        ctx.fillText('no glyph', 48, 80);
        return;
      }
      const em = 110;
      drawGlyph(ctx, glyph, doc.metrics, em, 20, 118, { color, guides: true });
    };
    render(canvasA.current, docA);
    render(canvasB.current, docB);
  }, [docA, docB, cp]);

  if (!docA || !docB) return <div className="muted small">Load fonts into both Font A and Font B to compare them side by side.</div>;

  const glyphA = cp !== null ? docA.glyphs.find((g) => g.unicode === cp) : undefined;
  const glyphB = cp !== null ? docB.glyphs.find((g) => g.unicode === cp) : undefined;

  return (
    <div className="panel-section">
      <h3>Font A / Font B comparison</h3>
      <Field label="Character to compare" hint="Any single character, e.g. ა, 7, ?">
        <input value={char} onChange={(e) => setChar(e.target.value || 'A')} aria-label="Comparison character" style={{ fontSize: 18 }} />
      </Field>
      <div className="compare-grid">
        <div className="compare-cell">
          <h4>Font A — {docA.meta.fontFamily}</h4>
          <canvas ref={canvasA} style={{ width: 150, height: 150 }} />
          <div className="small muted">{glyphA ? `${glyphA.name} · adv ${glyphA.advanceWidth}` : 'missing'}</div>
          {glyphA && (
            <Btn className="small" tip="Copy this glyph into Font B" onClick={() => openModal({ type: 'transfer', from: 'A', glyphIds: [glyphA.id], mode: 'copy' })}>
              A → B
            </Btn>
          )}
        </div>
        <div className="compare-cell">
          <h4>Font B — {docB.meta.fontFamily}</h4>
          <canvas ref={canvasB} style={{ width: 150, height: 150 }} />
          <div className="small muted">{glyphB ? `${glyphB.name} · adv ${glyphB.advanceWidth}` : 'missing'}</div>
          {glyphB && (
            <Btn className="small" tip="Copy this glyph into Font A" onClick={() => openModal({ type: 'transfer', from: 'B', glyphIds: [glyphB.id], mode: 'copy' })}>
              B → A
            </Btn>
          )}
        </div>
      </div>
      <div className="hint">Aligns both glyphs on their baselines. Transfers are confirmed per batch and undoable; Move also removes the glyph from its source font.</div>
    </div>
  );
}
