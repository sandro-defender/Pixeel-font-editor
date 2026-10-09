/** All modal dialogs: new font, add glyph, metadata+license, export, transfer, resize, rasterize, help. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { FontDoc, FontMeta, Slot } from '../core/types';
import { createNewFont, computePixelLayout } from '../core/fontFactory';
import { makeEmptyGlyph } from '../state/glyphActions';
import { parseCodePointInput, describeCodePoint, isValidCodePoint } from '../core/unicodeNames';
import { validateMeta, deriveMetaFields } from '../core/metadata';
import { applyLicense, buildLicenseTxt, LICENSING_DISCLAIMER, type LicenseMode } from '../core/license';
import { buildOFLLicense, OFL_VERSION_NOTE } from '../core/oflText';
import { exportFont } from '../services/exportService';
import { DEFAULT_EXPORT_OPTIONS, type ExportReport } from '../core/fontCodec';
import { downloadArrayBuffer, downloadBlob } from '../services/persistence';
import { findConflicts, transferGlyphs, type CollisionStrategy, type MetricsMode } from '../core/transfer';
import { getSource } from '../core/sourceRegistry';
import { registerImportedSource } from '../services/persistence';
import { rasterizeContours, defaultRasterizeFrame } from '../core/rasterize';
import { Bitmap } from '../core/bitmap';
import { Btn, Checkbox, Field, ModalShell, SegBtns } from './ui';

// ---------------------------------------------------------------------------
// New font
// ---------------------------------------------------------------------------
export function NewFontDialog() {
  const loadFont = useStore((s) => s.loadFont);
  const setActive = useStore((s) => s.setActive);
  const closeModal = useStore((s) => s.closeModal);
  const fonts = useStore((s) => s.fonts);
  const toast = useStore((s) => s.toast);

  const [family, setFamily] = useState('My Pixel Font');
  const [style, setStyle] = useState('Regular');
  const [preset, setPreset] = useState<'8' | '16' | '32' | 'custom'>('16');
  const [cw, setCw] = useState(16);
  const [ch, setCh] = useState(16);

  const create = () => {
    const w = preset === 'custom' ? cw : Number(preset);
    const h = preset === 'custom' ? ch : Number(preset);
    if (w < 2 || h < 2 || w > 128 || h > 128) {
      toast('error', 'Grid dimensions must be between 2 and 128.');
      return;
    }
    const doc = createNewFont({ familyName: family, styleName: style, gridWidth: w, gridHeight: h });
    const slot: Slot = fonts.A === null ? 'A' : fonts.B === null ? 'B' : useStore.getState().active;
    loadFont(slot, doc, `${doc.meta.postScriptName}.pixeel`);
    setActive(slot);
    toast('success', `Created "${family}" in Font ${slot}.`);
    closeModal();
  };

  return (
    <ModalShell title="Create a new pixel font" onClose={closeModal}>
      <div className="grid2">
        <Field label="Family name">
          <input value={family} onChange={(e) => setFamily(e.target.value)} />
        </Field>
        <Field label="Style / subfamily">
          <input value={style} onChange={(e) => setStyle(e.target.value)} />
        </Field>
      </div>
      <Field label="Pixel grid size" hint="Each glyph starts as a grid of this size. Grids can be resized per glyph later.">
        <SegBtns
          value={preset}
          options={[
            { v: '8', label: '8 × 8' },
            { v: '16', label: '16 × 16' },
            { v: '32', label: '32 × 32' },
            { v: 'custom', label: 'Custom…' },
          ]}
          onChange={setPreset}
          ariaLabel="Grid preset"
        />
      </Field>
      {preset === 'custom' && (
        <div className="grid2">
          <Field label="Grid width (2–128)">
            <input type="number" min={2} max={128} value={cw} onChange={(e) => setCw(Number(e.target.value))} />
          </Field>
          <Field label="Grid height (2–128)">
            <input type="number" min={2} max={128} value={ch} onChange={(e) => setCh(Number(e.target.value))} />
          </Field>
        </div>
      )}
      <div className="hint">
        The grid spans one em: with height {preset === 'custom' ? ch : preset} cells the em square becomes{' '}
        {computePixelLayout(preset === 'custom' ? cw : Number(preset), preset === 'custom' ? ch : Number(preset)).unitsPerEm} units, baseline ~20% from the bottom.
      </div>
      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={create}>Create font</Btn>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Add glyph
// ---------------------------------------------------------------------------
export function AddGlyphDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const selectGlyph = useStore((s) => s.selectGlyph);
  const toast = useStore((s) => s.toast);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');

  const cp = parseCodePointInput(input);

  const add = () => {
    const doc = useStore.getState().fonts[props.slot];
    if (!doc) return;
    if (cp !== null) {
      if (!isValidCodePoint(cp)) {
        toast('error', 'Invalid Unicode code point.');
        return;
      }
      if (doc.glyphs.some((g) => g.unicode === cp)) {
        toast('error', `${describeCodePoint(cp)} already has a glyph. Select it instead, or unassign it first.`);
        return;
      }
    }
    let newId: string | null = null;
    commit(props.slot, 'Add glyph', (d) => {
      const g = makeEmptyGlyph(d, cp, name.trim() || undefined);
      newId = g.id;
      return { ...d, glyphs: [...d.glyphs, g] };
    });
    if (newId) selectGlyph(props.slot, newId);
    toast('success', cp === null ? 'Added an unmapped glyph.' : `Added glyph for ${describeCodePoint(cp)}.`);
    closeModal();
  };

  return (
    <ModalShell title="Add a glyph" onClose={closeModal}>
      <Field label="Character or code point" hint="A single character, U+10D0, 0x41 or 65. Leave empty for an unmapped glyph.">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} autoFocus />
      </Field>
      {cp !== null && <div className="hint">{describeCodePoint(cp)}</div>}
      <Field label="Glyph name (optional)">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="auto" />
      </Field>
      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={add}>Add glyph</Btn>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Metadata + license
// ---------------------------------------------------------------------------
const META_FIELDS: Array<{ key: keyof FontMeta; label: string; area?: boolean; hint?: string }> = [
  { key: 'fontFamily', label: 'Family name *' },
  { key: 'fontSubFamily', label: 'Style / subfamily *' },
  { key: 'fullName', label: 'Full name', hint: 'Auto-derived if empty' },
  { key: 'postScriptName', label: 'PostScript name', hint: 'Auto-generated if empty/invalid' },
  { key: 'version', label: 'Version' },
  { key: 'copyright', label: 'Copyright' },
  { key: 'designer', label: 'Author / designer' },
  { key: 'description', label: 'Description', area: true },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'urlOfFontVendor', label: 'Vendor URL' },
  { key: 'urlOfFontDesigner', label: 'Designer URL' },
];

export function MetadataDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot])!;

  const [meta, setMeta] = useState<FontMeta>(() => ({ ...doc.meta }));
  const [metrics, setMetrics] = useState({ ...doc.metrics });
  const [licMode, setLicMode] = useState<LicenseMode>(doc.meta.licence ? 'imported' : 'custom');
  const [customText, setCustomText] = useState(doc.meta.licence);
  const [customUrl, setCustomUrl] = useState(doc.meta.urlOfLicence);
  const [oflHolder, setOflHolder] = useState(doc.meta.designer || doc.meta.fontFamily);
  const [oflYear, setOflYear] = useState(String(new Date().getFullYear()));
  const [oflReserved, setOflReserved] = useState(doc.meta.fontFamily);

  const validation = validateMeta(deriveMetaFields(meta));

  const save = () => {
    const derived = deriveMetaFields(meta);
    const v = validateMeta(derived);
    if (v.errors.length) {
      toast('error', v.errors.join(' '));
      return;
    }
    const licensed = applyLicense(derived, {
      mode: licMode,
      customText,
      customUrl,
      oflCopyrightHolder: oflHolder,
      oflYear,
      oflReservedNames: oflReserved,
    });
    commit(props.slot, 'Edit metadata', (d) => ({
      ...d,
      meta: licensed,
      metrics: { ...metrics, unitsPerEm: Math.round(metrics.unitsPerEm), ascent: Math.round(metrics.ascent), descent: Math.round(metrics.descent), lineGap: Math.round(metrics.lineGap) },
    }));
    toast('success', 'Font metadata updated.');
    closeModal();
  };

  return (
    <ModalShell title={`Font info & license — Font ${props.slot}`} onClose={closeModal} wide>
      <div className="grid2">
        {META_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.area ? (
              <textarea value={(meta[f.key] as string) ?? ''} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} />
            ) : (
              <input value={(meta[f.key] as string) ?? ''} onChange={(e) => setMeta({ ...meta, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
      </div>

      <div className="panel-section">
        <h3>Global metrics</h3>
        <div className="grid2">
          <Field label="Units per em" hint="Changing this rescales nothing — edit with care on imported fonts.">
            <input type="number" value={metrics.unitsPerEm} onChange={(e) => setMetrics({ ...metrics, unitsPerEm: Number(e.target.value) })} />
          </Field>
          <Field label="Line gap">
            <input type="number" value={metrics.lineGap} onChange={(e) => setMetrics({ ...metrics, lineGap: Number(e.target.value) })} />
          </Field>
          <Field label="Ascent (positive)">
            <input type="number" value={metrics.ascent} onChange={(e) => setMetrics({ ...metrics, ascent: Number(e.target.value) })} />
          </Field>
          <Field label="Descent (negative)">
            <input type="number" value={metrics.descent} onChange={(e) => setMetrics({ ...metrics, descent: Number(e.target.value) })} />
          </Field>
        </div>
      </div>

      <div className="panel-section">
        <h3>License</h3>
        <SegBtns
          ariaLabel="License mode"
          value={licMode}
          options={[
            { v: 'imported', label: 'Keep imported', tip: 'Preserve whatever license the imported font carries (default)' },
            { v: 'custom', label: 'Custom text', tip: 'Write your own license text' },
            { v: 'ofl', label: 'SIL OFL template', tip: 'Generate a SIL Open Font License 1.1 document' },
          ]}
          onChange={setLicMode}
        />
        {licMode === 'imported' && (
          <div className="hint">Current license fields are left exactly as imported:{doc.meta.licence ? ` “${doc.meta.licence.slice(0, 120)}${doc.meta.licence.length > 120 ? '…' : ''}”` : ' (none found)'}</div>
        )}
        {licMode === 'custom' && (
          <>
            <Field label="License text">
              <textarea value={customText} onChange={(e) => setCustomText(e.target.value)} style={{ minHeight: 110 }} />
            </Field>
            <Field label="License URL">
              <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} />
            </Field>
          </>
        )}
        {licMode === 'ofl' && (
          <>
            <div className="grid2">
              <Field label="Copyright holder">
                <input value={oflHolder} onChange={(e) => setOflHolder(e.target.value)} />
              </Field>
              <div className="grid2">
                <Field label="Year">
                  <input value={oflYear} onChange={(e) => setOflYear(e.target.value)} />
                </Field>
                <Field label="Reserved Font Name(s)" hint="Optional, per OFL clause 3">
                  <input value={oflReserved} onChange={(e) => setOflReserved(e.target.value)} />
                </Field>
              </div>
            </div>
            <details>
              <summary className="small" style={{ cursor: 'pointer' }}>{OFL_VERSION_NOTE} — full text</summary>
              <pre className="small muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>{buildOFLLicense({ copyrightHolder: oflHolder, year: oflYear, reservedFontNames: oflReserved })}</pre>
            </details>
          </>
        )}
        <div className="row">
          <Btn
            tip="Download a standalone LICENSE.txt"
            onClick={() => {
              const licensed = applyLicense(deriveMetaFields(meta), { mode: licMode, customText, customUrl, oflCopyrightHolder: oflHolder, oflYear, oflReservedNames: oflReserved });
              downloadBlob(new Blob([buildLicenseTxt(licensed, { mode: licMode, customText, customUrl, oflCopyrightHolder: oflHolder, oflYear, oflReservedNames: oflReserved })], { type: 'text/plain' }), 'LICENSE.txt');
            }}
          >
            ⬇ Export LICENSE.txt
          </Btn>
        </div>
        <div className="warning-box">{LICENSING_DISCLAIMER}</div>
      </div>

      {validation.warnings.length > 0 && (
        <div className="hint">⚠ {validation.warnings.join(' · ')}</div>
      )}
      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={validation.errors.length > 0} tip={validation.errors.join(' ')}>
          Save metadata
        </Btn>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
export function ExportDialog(props: { slot: Slot }) {
  const closeModal = useStore((s) => s.closeModal);
  const setBusy = useStore((s) => s.setBusy);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot])!;
  const [preserveHinting, setPreserveHinting] = useState(true);
  const [preserveKerning, setPreserveKerning] = useState(true);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const src = doc.source;
  const droppedPreview = useMemo(() => {
    if (!src) return [];
    return src.tables.filter((t) => !['glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'cmap', 'name', 'post', 'OS/2'].includes(t) && !(preserveHinting && ['cvt ', 'cvt', 'fpgm', 'prep', 'gasp'].includes(t)) && !(preserveKerning && ['GPOS', 'kern', 'kerx'].includes(t)));
  }, [src, preserveHinting, preserveKerning]);

  const run = async () => {
    setError(null);
    setReport(null);
    setBuffer(null);
    setBusy('Exporting TTF (building, writing, re-parsing to validate)…');
    try {
      const out = await exportFont(doc, { ...DEFAULT_EXPORT_OPTIONS, preserveHinting, preserveKerning });
      setBuffer(out.buffer);
      setReport(out.report);
      if (!out.report.validation?.ok) setError('Validation reported problems — review the checks below before using this file.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const psName = doc.meta.postScriptName || 'font';

  return (
    <ModalShell title={`Export TTF — Font ${props.slot} (${doc.meta.fontFamily})`} onClose={closeModal} wide>
      {src && src.format !== 'created' && (
        <div className="panel-section">
          <h3>Source: {src.fileName}</h3>
          <div className="row small">
            <span className="chip">{src.numGlyphs} glyphs</span>
            {src.hasComposites && <span className="chip">composite glyphs — preserved when unedited</span>}
            {src.hasHinting && <span className="chip">hinting present</span>}
            {src.hasKerning && <span className="chip">kerning/GPOS present</span>}
          </div>
          <div className="grid2">
            <Checkbox label="Preserve hinting (cvt/fpgm/prep/gasp + per-glyph instructions of unedited glyphs)" checked={preserveHinting} onChange={setPreserveHinting} disabled={!src.hasHinting} />
            <Checkbox label="Preserve kerning tables (GPOS/kern/kerx)" checked={preserveKerning} onChange={setPreserveKerning} disabled={!src.hasKerning} />
          </div>
          {droppedPreview.length > 0 && (
            <div className="warning-box">
              Tables that <strong>cannot</strong> be preserved and will be dropped: {droppedPreview.map((t) => <span key={t} className="chip">{t.trim()}</span>)}
              <div className="hint small" style={{ marginTop: 4 }}>
                This includes e.g. GSUB shaping, variable-font data (fvar/gvar), color layers, and DSIG signatures. The exported file remains a valid standalone TTF; this is a <em>simplified export</em> for those tables.
              </div>
            </div>
          )}
        </div>
      )}

      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={run}>{buffer ? '↻ Re-export' : 'Export & validate'}</Btn>
        {buffer && (
          <Btn kind="primary" onClick={() => downloadArrayBuffer(buffer, `${psName}.ttf`)} tip="Download the validated TTF">
            ⬇ Download {psName}.ttf ({Math.ceil((buffer.byteLength ?? 0) / 1024)} KB)
          </Btn>
        )}
        {buffer && (
          <Btn
            onClick={() => downloadBlob(new Blob([buildLicenseTxt(doc.meta)], { type: 'text/plain' }), 'LICENSE.txt')}
            tip="Also ship a license file with your font"
          >
            ⬇ LICENSE.txt
          </Btn>
        )}
      </div>

      {error && <div className="error-box">{error}</div>}

      {report && (
        <div className="panel-section">
          <h3>Export report</h3>
          <table className="report-table">
            <tbody>
              <tr><td>File size</td><td>{report.bytes.toLocaleString()} bytes</td></tr>
              <tr><td>Tables written</td><td>{report.writtenTables.map((t) => <span key={t} className="chip">{t.trim()}</span>)}</td></tr>
              <tr><td>Preserved from source</td><td>{report.preservedTables.length ? report.preservedTables.map((t) => <span key={t} className="chip">{t.trim()}</span>) : '—'}</td></tr>
              <tr><td>Dropped</td><td>{report.droppedTables.length ? report.droppedTables.map((t) => <span key={t} className="chip">{t.trim()}</span>) : 'none'}</td></tr>
              {report.notes.length > 0 && (
                <tr><td>Notes</td><td><ul className="tight">{report.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></td></tr>
              )}
            </tbody>
          </table>
          {report.validation && (
            <>
              <h3 style={{ marginTop: 8 }}>Validation (re-parse of the exported file)</h3>
              <table className="report-table">
                <tbody>
                  {report.validation.checks.map((c) => (
                    <tr key={c.name}>
                      <td>{c.ok ? '✅' : '❌'} {c.name}</td>
                      <td>{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {report.validation.ok ? <div className="ok-box">The exported file re-parsed cleanly and representative glyphs verified.</div> : <div className="error-box">Validation failed — inspect the checks above.</div>}
            </>
          )}
        </div>
      )}
      <div className="hint">Your original uploaded file is never modified or overwritten — export always writes a new file.</div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Transfer between fonts
// ---------------------------------------------------------------------------
export function TransferDialog(props: { from: Slot; glyphIds: string[] }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const loadFont = useStore((s) => s.loadFont);
  const toast = useStore((s) => s.toast);
  const srcDoc = useStore((s) => s.fonts[props.from])!;
  const to: Slot = props.from === 'A' ? 'B' : 'A';
  const dstDoc = useStore((s) => s.fonts[to]);

  const [metricsMode, setMetricsMode] = useState<MetricsMode>('preserve');
  const [scaleUpm, setScaleUpm] = useState(true);
  const [collision, setCollision] = useState<CollisionStrategy>('replace');
  const [reassign, setReassign] = useState<Record<string, string>>({});
  const [confirmStep, setConfirmStep] = useState(false);
  const [conflictResolution, setConflictResolution] = useState<Record<string, CollisionStrategy>>({});

  const glyphs = srcDoc.glyphs.filter((g) => props.glyphIds.includes(g.id));
  const conflicts = useMemo(() => (dstDoc ? findConflicts(srcDoc, dstDoc, props.glyphIds) : []), [srcDoc, dstDoc, props.glyphIds]);

  if (!dstDoc) {
    return (
      <ModalShell title={`Transfer to Font ${to}`} onClose={closeModal}>
        <div className="warning-box">Font {to} is empty. Create or open a font there first, then transfer again.</div>
        <div className="modal-actions"><Btn onClick={closeModal}>Close</Btn></div>
      </ModalShell>
    );
  }

  const perGlyphStrategy = (id: string): CollisionStrategy => conflictResolution[id] ?? collision;

  // transferGlyphs needs a src doc snapshot (unchanged during this dialog)
  const srcDocForTransfer = srcDoc;
  let lastResult = { copied: 0, skipped: 0, replaced: 0, reassigned: 0, flattenedComposites: 0 };
  let lastNotes: string[] = [];

  const apply = () => {
    // group by strategy since transferGlyphs takes one strategy per call
    const groups = new Map<CollisionStrategy, string[]>();
    for (const g of glyphs) {
      const hasConflict = conflicts.some((c) => c.glyphId === g.id);
      const strat = hasConflict ? perGlyphStrategy(g.id) : 'skip';
      groups.set(strat, [...(groups.get(strat) ?? []), g.id]);
    }
    const reassignments: Record<string, number | null> = {};
    for (const [id, raw] of Object.entries(reassign)) {
      reassignments[id] = raw.trim() === '' ? null : parseCodePointInput(raw);
    }

    commit(to, 'Transfer glyphs', (dst) => {
      let next = dst;
      let totals = { copied: 0, skipped: 0, replaced: 0, reassigned: 0, flattenedComposites: 0 };
      const notes: string[] = [];
      for (const [strat, ids] of groups) {
        if (!ids.length) continue;
        const res = transferGlyphs(srcDocForTransfer, next, ids, { metricsMode, scaleByUpm: scaleUpm, collision: strat, reassignments });
        next = res.doc;
        totals = {
          copied: totals.copied + res.copied,
          skipped: totals.skipped + res.skipped,
          replaced: totals.replaced + res.replaced,
          reassigned: totals.reassigned + res.reassigned,
          flattenedComposites: totals.flattenedComposites + res.flattenedComposites,
        };
        notes.push(...res.notes);
      }
      lastResult = totals;
      lastNotes = notes;
      return next;
    });
    toast('success', `Transfer complete: ${lastResult.copied} copied, ${lastResult.replaced} replaced, ${lastResult.reassigned} reassigned, ${lastResult.skipped} skipped.${lastResult.flattenedComposites ? ` ${lastResult.flattenedComposites} composite(s) flattened.` : ''} Undo with Ctrl+Z in Font ${to}.`);
    lastNotes.forEach((n) => toast('warning', n));
    closeModal();
  };

  return (
    <ModalShell title={`Copy ${glyphs.length} glyph(s): Font ${props.from} → Font ${to}`} onClose={closeModal} wide>
      <div className="hint">
        Source “{srcDoc.meta.fontFamily}” (upm {srcDoc.metrics.unitsPerEm}) → Destination “{dstDoc.meta.fontFamily}” (upm {dstDoc.metrics.unitsPerEm}).
        Glyphs are matched by identity, never by glyph index.
      </div>
      <div className="panel-section">
        <h3>Options</h3>
        <SegBtns
          ariaLabel="Metrics handling"
          value={metricsMode}
          options={[
            { v: 'preserve', label: 'Preserve source metrics', tip: 'Copy advance width (scaled if proportional scaling is on)' },
            { v: 'adapt', label: 'Adapt to destination', tip: 'Recompute advance from the copied outline extents' },
          ]}
          onChange={setMetricsMode}
        />
        <Checkbox
          label={`Proportional scaling by units-per-em (×${(dstDoc.metrics.unitsPerEm / srcDoc.metrics.unitsPerEm).toFixed(3)})`}
          checked={scaleUpm}
          onChange={setScaleUpm}
          tip="Scales outlines and metrics so the glyph keeps its relative size in the destination font"
        />
        <div className="hint">Copied glyphs align on the destination baseline; pixel grids keep their cell layout (only their cell size in units is scaled).</div>
      </div>

      {conflicts.length > 0 && (
        <div className="panel-section">
          <h3>Unicode collisions ({conflicts.length})</h3>
          <div className="row">
            <span className="small muted">Default:</span>
            <SegBtns
              ariaLabel="Collision strategy"
              value={collision}
              options={[
                { v: 'replace', label: 'Replace', tip: 'Unmap the existing destination glyph and map the incoming one' },
                { v: 'skip', label: 'Skip', tip: 'Do not copy colliding glyphs' },
                { v: 'reassign', label: 'Reassign', tip: 'Assign a different (or no) code point to the incoming glyph' },
              ]}
              onChange={setCollision}
            />
          </div>
          {conflicts.map((c) => {
            const strat = perGlyphStrategy(c.glyphId);
            const dstGlyph = dstDoc.glyphs.find((g) => g.id === c.existingId);
            return (
              <div key={c.glyphId} className="conflict-row">
                <strong>{String.fromCodePoint(c.unicode)}</strong>
                <span>U+{c.unicode.toString(16).toUpperCase()} — dest. has “{dstGlyph?.name}”</span>
                <span className="spacer" />
                <select value={strat} onChange={(e) => setConflictResolution({ ...conflictResolution, [c.glyphId]: e.target.value as CollisionStrategy })} aria-label={`Strategy for ${c.glyphName}`}>
                  <option value="replace">replace</option>
                  <option value="skip">skip</option>
                  <option value="reassign">reassign</option>
                </select>
                {strat === 'reassign' && (
                  <input
                    placeholder="new U+ or empty=unmapped"
                    value={reassign[c.glyphId] ?? ''}
                    onChange={(e) => setReassign({ ...reassign, [c.glyphId]: e.target.value })}
                    aria-label={`New code point for ${c.glyphName}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="panel-section">
        <h3>Glyphs to copy</h3>
        <div className="row">
          {glyphs.slice(0, 40).map((g) => (
            <span key={g.id} className="chip" title={g.name}>
              {g.unicode !== null ? String.fromCodePoint(g.unicode) : '·'} {g.name}
            </span>
          ))}
          {glyphs.length > 40 && <span className="chip">+{glyphs.length - 40} more</span>}
        </div>
      </div>

      {!confirmStep ? (
        <div className="modal-actions">
          <Btn onClick={closeModal}>Cancel</Btn>
          <Btn kind="primary" onClick={() => setConfirmStep(true)}>Review & confirm…</Btn>
        </div>
      ) : (
        <>
          <div className="warning-box">
            This will {metricsMode === 'preserve' ? 'preserve source metrics' : 'adapt metrics to the destination'}
            {scaleUpm ? ', scale proportionally to units-per-em' : ''}, and resolve collisions by “{conflicts.length ? 'per-glyph choices above' : collision}”.
            The operation is a single undo step in Font {to}.
          </div>
          <div className="modal-actions">
            <Btn onClick={() => setConfirmStep(false)}>← Back</Btn>
            <Btn kind="primary" onClick={apply}>Copy {glyphs.length} glyph(s) into Font {to}</Btn>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Resize pixel grid
// ---------------------------------------------------------------------------
export function ResizeGridDialog(props: { slot: Slot; glyphId: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot])!;
  const glyph = doc.glyphs.find((g) => g.id === props.glyphId)!;
  const pixel = glyph.pixel!;
  const [w, setW] = useState(pixel.width);
  const [h, setH] = useState(pixel.height);
  const [mode, setMode] = useState<'crop' | 'center' | 'resample'>('crop');

  const apply = () => {
    if (w < 1 || h < 1 || w > 128 || h > 128) {
      toast('error', 'Grid size must be 1–128.');
      return;
    }
    commit(props.slot, 'Resize grid', (d) => {
      const g = d.glyphs.find((x) => x.id === props.glyphId)!;
      const bm = Bitmap.fromB64(g.pixel!.width, g.pixel!.height, g.pixel!.cellsB64).resized(w, h, mode);
      return { ...d, glyphs: d.glyphs.map((x) => (x.id === g.id ? { ...x, pixel: { ...x.pixel!, width: w, height: h, cellsB64: bm.toB64() }, edited: true } : x)) };
    });
    toast('success', `Grid resized to ${w}×${h} (${mode === 'crop' ? 'crop/pad bottom-left' : mode === 'center' ? 'crop/pad centered' : 'nearest-neighbour resample'}).`);
    closeModal();
  };

  return (
    <ModalShell title={`Resize pixel grid — ${glyph.name}`} onClose={closeModal}>
      <div className="hint">Current: {pixel.width}×{pixel.height}. Baseline sits {pixel.baselineRow} rows from the bottom; placement in font units stays anchored so the glyph does not silently shift.</div>
      <div className="grid2">
        <Field label="New width"><input type="number" min={1} max={128} value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
        <Field label="New height"><input type="number" min={1} max={128} value={h} onChange={(e) => setH(Number(e.target.value))} /></Field>
      </div>
      <Field label="How to fit the existing drawing" hint="Crop/pad never distorts; resample scales with nearest-neighbour.">
        <SegBtns
          value={mode}
          options={[
            { v: 'crop', label: 'Crop / pad (baseline-anchored)', tip: 'Keep the bottom-left region, pad new space with empty pixels' },
            { v: 'center', label: 'Crop / pad (centered)', tip: 'Crop or pad equally on all sides' },
            { v: 'resample', label: 'Resample (nearest)', tip: 'Scale the bitmap to the new size; can alias but keeps proportions' },
          ]}
          onChange={setMode}
          ariaLabel="Resize mode"
        />
      </Field>
      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={apply}>Apply</Btn>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Rasterize vector glyph → pixels
// ---------------------------------------------------------------------------
export function RasterizeDialog(props: { slot: Slot; glyphId: string }) {
  const closeModal = useStore((s) => s.closeModal);
  const commit = useStore((s) => s.commit);
  const toast = useStore((s) => s.toast);
  const doc = useStore((s) => s.fonts[props.slot])!;
  const glyph = doc.glyphs.find((g) => g.id === props.glyphId)!;
  // compound glyphs carry their flattened contours from import time
  const contours = glyph.contours;
  const [gridH, setGridH] = useState(16);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const frame = useMemo(() => defaultRasterizeFrame(contours, doc.metrics, Math.max(4, Math.min(128, gridH))), [contours, doc.metrics, gridH]);
  const raster = useMemo(() => rasterizeContours(contours, frame), [contours, frame]);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    const scale = 6;
    canvas.width = raster.width * scale;
    canvas.height = raster.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bm = Bitmap.fromB64(raster.width, raster.height, raster.cellsB64);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
    for (let y = 0; y < bm.height; y++) {
      for (let x = 0; x < bm.width; x++) {
        if (bm.get(x, y)) ctx.fillRect(x * scale, (bm.height - 1 - y) * scale, scale, scale);
      }
    }
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--guide').trim() || '#26c';
    ctx.setLineDash([4, 3]);
    const yBase = (raster.height - raster.baselineRow) * scale;
    ctx.beginPath();
    ctx.moveTo(0, yBase);
    ctx.lineTo(canvas.width, yBase);
    ctx.stroke();
  }, [raster]);

  const apply = () => {
    commit(props.slot, 'Rasterize to pixels', (d) => ({
      ...d,
      glyphs: d.glyphs.map((g) =>
        g.id === props.glyphId
          ? {
              ...g,
              pixel: { width: raster.width, height: raster.height, cellsB64: raster.cellsB64, unitsPerCell: raster.unitsPerCell, offsetX: raster.offsetX, baselineRow: raster.baselineRow },
              kind: 'pixel',
              sourceContours: g.contours.length ? g.contours.map((c) => c.map((p) => ({ ...p }))) : g.sourceContours,
              edited: true,
            }
          : g,
      ),
    }));
    toast('success', 'Glyph converted to a pixel grid. The original outline is kept — use “Revert to original outline” any time before export replaces it.');
    closeModal();
  };

  return (
    <ModalShell title={`Convert to pixel grid — ${glyph.name}`} onClose={closeModal}>
      <div className="warning-box">
        Rasterization <strong>loses vector detail</strong>: curves become cell-sized steps. This only prepares an editable grid — the original outline is kept until you export the edited pixel version (explicit), and you can revert at any time.
      </div>
      <Field label={`Grid height — ${gridH} rows across ascent→descent`}>
        <input type="range" min={4} max={64} value={gridH} onChange={(e) => setGridH(Number(e.target.value))} aria-label="Rasterize grid height" />
      </Field>
      <div className="row">
        <canvas ref={previewRef} style={{ border: '1px solid var(--border)', borderRadius: 4, background: 'var(--panel-2)' }} aria-label="Rasterization preview" />
        <div className="small muted">
          {raster.width}×{raster.height} cells · {raster.unitsPerCell.toFixed(1)} units/cell · baseline row {raster.baselineRow}
          <br />blue dashed line = baseline
        </div>
      </div>
      <div className="modal-actions">
        <Btn onClick={closeModal}>Cancel</Btn>
        <Btn kind="primary" onClick={apply}>Create editable pixel grid</Btn>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------
export function HelpDialog() {
  const closeModal = useStore((s) => s.closeModal);
  return (
    <ModalShell title="Pixeel help & shortcuts" onClose={closeModal} wide>
      <div className="panel-section">
        <h3>Keyboard shortcuts (pixel editor)</h3>
        <table className="report-table">
          <tbody>
            {[
              ['B / P', 'Pencil'], ['E', 'Eraser'], ['F', 'Flood fill'], ['L', 'Line'], ['R', 'Rectangle'], ['M / S', 'Select & move'],
              ['Arrows', 'Shift bitmap (or move selection when active)'], ['Ctrl+C / X / V', 'Copy / cut / paste'],
              ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['I', 'Invert'], ['Delete', 'Clear selection or grid'], ['G', 'Toggle grid lines'],
              ['+ / −', 'Zoom'], ['Esc', 'Cancel selection / stroke'],
            ].map(([k, v]) => (
              <tr key={k}><td><span className="kbd">{k}</span></td><td>{v}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-section">
        <h3>How it works</h3>
        <ul className="tight small">
          <li><strong>Pixel fonts:</strong> you draw on a grid; export traces filled pixels into sharp TrueType outlines (holes become counters). No bitmap strikes are embedded — the TTF contains real scalable outlines.</li>
          <li><strong>Imported fonts:</strong> original vector outlines are preserved until you edit a glyph. Edited glyphs lose their hinting instructions (reported at export). Composite glyphs are preserved while unedited and can be flattened explicitly.</li>
          <li><strong>Two fonts:</strong> use the Compare tab or multi-select glyphs in the browser, then “Transfer”. Transfers are one undo step in the destination font.</li>
          <li><strong>Safety:</strong> your uploaded files are never modified; recovery snapshots are saved to IndexedDB as you work; project files are JSON you control.</li>
        </ul>
      </div>
      <div className="modal-actions"><Btn kind="primary" onClick={closeModal}>Got it</Btn></div>
    </ModalShell>
  );
}
