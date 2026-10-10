/**
 * Kerning pairs: model, editing, frequency ranking and the binary `kern` /
 * GPOS codecs.
 *
 * Pairs are stored by glyph id (stable across glyph reordering / deletion) and
 * hold the horizontal adjustment in font units, added to the advance of the
 * left glyph (negative = tighter).
 *
 * Import reads the classic `kern` table (format 0) and GPOS PairPos lookups
 * (formats 1 and 2, class pairs expanded) of the `kern` feature. Export writes
 * a format-0 `kern` table whenever the pairs were edited in Pixeel.
 */
import type { FontDoc, GlyphDoc, KerningPair } from './types';
import { parseCodePointInput } from './unicodeNames';

export const MAX_KERN_VALUE = 32767;
/** One format-0 subtable holds at most (65535 − 14) / 6 pairs. */
export const KERN_PAIRS_PER_SUBTABLE = 10920;
/** Pairs kept after import. Class-based GPOS kerning expands to hundreds of thousands of pairs. */
export const MAX_IMPORTED_PAIRS = 25000;
/** Safety limit while expanding class kerning (memory). */
const MAX_EXPANDED_PAIRS = 800000;

// ---------------------------------------------------------------------------
// Pair model
// ---------------------------------------------------------------------------

export const pairKey = (left: string, right: string): string => `${left}\u0000${right}`;

export function kerningOf(doc: FontDoc): KerningPair[] {
  return doc.kerning ?? [];
}

/** Value of a pair (0 when there is none). */
export function getKerning(doc: FontDoc, left: string, right: string): number {
  const p = kerningOf(doc).find((k) => k.left === left && k.right === right);
  return p ? p.value : 0;
}

/** Lookup map for fast layout. */
export function kerningMap(pairs: KerningPair[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pairs) m.set(pairKey(p.left, p.right), p.value);
  return m;
}

function checkValue(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Kerning value must be a number.');
  const v = Math.round(value);
  if (Math.abs(v) > MAX_KERN_VALUE) throw new Error(`Kerning value must be between −${MAX_KERN_VALUE} and ${MAX_KERN_VALUE}.`);
  return v;
}

function requireGlyph(doc: FontDoc, id: string): GlyphDoc {
  const g = doc.glyphs.find((x) => x.id === id);
  if (!g) throw new Error('Glyph not found.');
  return g;
}

/** Add a pair or change an existing one. Throws for unknown glyphs or out-of-range values. */
export function setKerningPair(doc: FontDoc, left: string, right: string, value: number): FontDoc {
  requireGlyph(doc, left);
  requireGlyph(doc, right);
  const v = checkValue(value);
  const pairs = kerningOf(doc);
  const exists = pairs.some((p) => p.left === left && p.right === right);
  const next = exists ? pairs.map((p) => (p.left === left && p.right === right ? { ...p, value: v } : p)) : [...pairs, { left, right, value: v }];
  return { ...doc, kerning: next, kerningEdited: true };
}

export function deleteKerningPair(doc: FontDoc, left: string, right: string): FontDoc {
  const pairs = kerningOf(doc);
  if (!pairs.some((p) => p.left === left && p.right === right)) return doc;
  return { ...doc, kerning: pairs.filter((p) => !(p.left === left && p.right === right)), kerningEdited: true };
}

/** Remove pairs that mention any of the given glyphs (used when glyphs are deleted). */
export function dropKerningFor(doc: FontDoc, glyphIds: Iterable<string>): FontDoc {
  const gone = new Set(glyphIds);
  const pairs = doc.kerning;
  if (!pairs) return doc;
  const kept = pairs.filter((p) => !gone.has(p.left) && !gone.has(p.right));
  return kept.length === pairs.length ? doc : { ...doc, kerning: kept, kerningEdited: true };
}

/** Multiply every value by `factor` (unitsPerEm changed). */
export function scaleKerning(doc: FontDoc, factor: number): FontDoc {
  if (!doc.kerning?.length || factor === 1) return doc;
  return {
    ...doc,
    kerning: doc.kerning.map((p) => ({ ...p, value: Math.max(-MAX_KERN_VALUE, Math.min(MAX_KERN_VALUE, Math.round(p.value * factor))) })),
    kerningEdited: true,
  };
}

/** Pairs whose value is 0 do nothing; they are not exported. */
export const effectivePairs = (pairs: KerningPair[]): KerningPair[] => pairs.filter((p) => p.value !== 0);

// ---------------------------------------------------------------------------
// Resolving what the user typed
// ---------------------------------------------------------------------------

/**
 * Find the glyph a text field refers to: a character ("A"), a code point
 * ("U+0041", "0x41", "65") or a glyph name ("A", "Aacute", "space").
 */
export function resolveGlyphInput(doc: FontDoc, input: string): GlyphDoc | null {
  const raw = input.trim();
  if (!raw) return null;
  const cp = parseCodePointInput(raw);
  if (cp !== null) {
    const byCp = doc.glyphs.find((g) => g.unicode === cp);
    if (byCp) return byCp;
  }
  return doc.glyphs.find((g) => g.name === raw) ?? null;
}

/**
 * Parse "AV", "A V", "U+0041 U+0056" or "A,V" typed into one box into two
 * glyphs. Returns null when it cannot be split unambiguously.
 */
export function resolvePairText(doc: FontDoc, text: string): { left: GlyphDoc; right: GlyphDoc } | null {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 2) {
    const l = resolveGlyphInput(doc, parts[0]);
    const r = resolveGlyphInput(doc, parts[1]);
    return l && r ? { left: l, right: r } : null;
  }
  const chars = Array.from(t);
  if (chars.length === 2) {
    const l = resolveGlyphInput(doc, chars[0]);
    const r = resolveGlyphInput(doc, chars[1]);
    return l && r ? { left: l, right: r } : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Frequency ranking
// ---------------------------------------------------------------------------

/** Most common English letter pairs, most frequent first. */
const COMMON_BIGRAMS =
  'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el ta la ns di fo ho pe ec pr no ct us ac ot il tr ly nc et ut ss so rs un lo wa ge ie wh ee wi em ad ol rt po we na ul ni ts mo ow pa im mi ai sh ir su id os iv ia am fi ci vi pl ig tu ev ld ry mp fe bl ab gh ty op wo sa ay ex ke fr oo av ag if ap gr od bo sp rd do uc bu ei ov by rm ep tt'.split(' ');

/** Pairs designers kern first (capitals with diagonals/round shapes, punctuation). */
const CLASSIC_KERN_PAIRS =
  'AV AW AY AT AC AG AO AQ AU LT LV LW LY PA P. P, TA To Ta Te Ti Tr Tu Tw Ty T. T, T- VA Va Ve Vo Vu V. V, WA Wa We Wo W. W, YA Ya Ye Yo Yu Y. Y, FA Fa Fe Fo F. F, RT RV RY r. r, y. y, v. v, w. w, 7. 7,'
    .split(' ');

/**
 * Rank of a pair in "how often does it matter" order (smaller = more common).
 * Classic kerning pairs come first, then common English bigrams; everything
 * else shares the same rank.
 */
export function pairFrequencyRank(leftChar: string | null, rightChar: string | null): number {
  if (!leftChar || !rightChar) return Number.POSITIVE_INFINITY;
  const classic = CLASSIC_KERN_PAIRS.indexOf(leftChar + rightChar);
  if (classic >= 0) return classic;
  const lower = (leftChar + rightChar).toLowerCase();
  const common = COMMON_BIGRAMS.indexOf(lower);
  if (common >= 0) return CLASSIC_KERN_PAIRS.length + common;
  return Number.POSITIVE_INFINITY;
}

export type KerningSort = 'frequency' | 'value' | 'left';

export interface KerningRow {
  pair: KerningPair;
  left: GlyphDoc;
  right: GlyphDoc;
  leftChar: string;
  rightChar: string;
  rank: number;
}

const charOf = (g: GlyphDoc): string => (g.unicode !== null ? String.fromCodePoint(g.unicode) : '');

/** Rows for the editor list: resolved glyphs, filtered by `query`, sorted. Pairs with a deleted glyph are skipped. */
export function kerningRows(doc: FontDoc, query: string, sort: KerningSort): KerningRow[] {
  const byId = new Map(doc.glyphs.map((g) => [g.id, g]));
  const q = query.trim().toLowerCase();
  const rows: KerningRow[] = [];
  for (const pair of kerningOf(doc)) {
    const left = byId.get(pair.left);
    const right = byId.get(pair.right);
    if (!left || !right) continue;
    const leftChar = charOf(left);
    const rightChar = charOf(right);
    if (q) {
      const hay = [leftChar, rightChar, leftChar + rightChar, left.name, right.name, left.unicode !== null ? `u+${left.unicode.toString(16).padStart(4, '0')}` : '', right.unicode !== null ? `u+${right.unicode.toString(16).padStart(4, '0')}` : '', String(pair.value)]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q) && !(leftChar + rightChar).toLowerCase().includes(q)) continue;
    }
    rows.push({ pair, left, right, leftChar, rightChar, rank: pairFrequencyRank(leftChar, rightChar) });
  }
  const byCode = (a: KerningRow, b: KerningRow) =>
    (a.left.unicode ?? 0x110000) - (b.left.unicode ?? 0x110000) || (a.right.unicode ?? 0x110000) - (b.right.unicode ?? 0x110000) || a.left.name.localeCompare(b.left.name) || a.right.name.localeCompare(b.right.name);
  rows.sort((a, b) => {
    if (sort === 'value') return Math.abs(b.pair.value) - Math.abs(a.pair.value) || byCode(a, b);
    if (sort === 'frequency' && a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
    return byCode(a, b);
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Text layout with kerning (for the live preview)
// ---------------------------------------------------------------------------

export interface LaidOutGlyph {
  glyph: GlyphDoc;
  /** pen position (font units) of the glyph origin */
  x: number;
  /** kerning applied AFTER this glyph (to the next one); 0 when there is no pair */
  kern: number;
  /** the character in the text that produced this glyph */
  char: string;
}

/** Position the characters of `text`; characters without a glyph are skipped. */
export function layoutKerned(doc: FontDoc, text: string, pairs: KerningPair[] = kerningOf(doc), withKerning = true): { glyphs: LaidOutGlyph[]; width: number } {
  const byCp = new Map<number, GlyphDoc>();
  for (const g of doc.glyphs) if (g.unicode !== null && !byCp.has(g.unicode)) byCp.set(g.unicode, g);
  const map = kerningMap(pairs);
  const out: LaidOutGlyph[] = [];
  let x = 0;
  let prev: LaidOutGlyph | null = null;
  for (const ch of Array.from(text)) {
    const glyph = byCp.get(ch.codePointAt(0)!);
    if (!glyph) continue;
    if (prev && withKerning) {
      const k = map.get(pairKey(prev.glyph.id, glyph.id)) ?? 0;
      prev.kern = k;
      x += k;
    }
    const item: LaidOutGlyph = { glyph, x, kern: 0, char: ch };
    out.push(item);
    x += glyph.advanceWidth;
    prev = item;
  }
  return { glyphs: out, width: x };
}

export interface TextRun {
  text: string;
  /** true when the run consists of characters that take part in a non-zero kerning pair */
  kerned: boolean;
}

/**
 * Split `text` into runs so a preview can highlight kerned pairs: consecutive
 * characters connected by a non-zero pair form one highlighted run.
 */
export function kernedRuns(doc: FontDoc, text: string, pairs: KerningPair[] = kerningOf(doc)): { runs: TextRun[]; pairCount: number } {
  const chars = Array.from(text);
  const byCp = new Map<number, GlyphDoc>();
  for (const g of doc.glyphs) if (g.unicode !== null && !byCp.has(g.unicode)) byCp.set(g.unicode, g);
  const map = kerningMap(pairs);
  const marked = new Array<boolean>(chars.length).fill(false);
  let pairCount = 0;
  let prev: { i: number; glyph: GlyphDoc } | null = null;
  chars.forEach((ch, i) => {
    const glyph = byCp.get(ch.codePointAt(0)!);
    if (!glyph) {
      prev = null;
      return;
    }
    if (prev && prev.i === i - 1 && (map.get(pairKey(prev.glyph.id, glyph.id)) ?? 0) !== 0) {
      marked[prev.i] = true;
      marked[i] = true;
      pairCount++;
    }
    prev = { i, glyph };
  });
  const runs: TextRun[] = [];
  chars.forEach((ch, i) => {
    const last = runs[runs.length - 1];
    if (last && last.kerned === marked[i]) last.text += ch;
    else runs.push({ text: ch, kerned: marked[i] });
  });
  return { runs, pairCount };
}

// ---------------------------------------------------------------------------
// Binary: classic `kern` table
// ---------------------------------------------------------------------------

export interface IndexPair {
  left: number;
  right: number;
  value: number;
}

const toU8 = (bytes: ArrayLike<number> | ArrayBuffer): Uint8Array => (bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes as ArrayLike<number>));

/** Serialise glyph-index pairs as a `kern` table (version 0, format-0 subtables). Zero values are skipped. */
export function buildKernTable(pairs: IndexPair[]): number[] {
  const sorted = pairs
    .filter((p) => p.value !== 0 && p.left >= 0 && p.right >= 0 && p.left <= 0xffff && p.right <= 0xffff)
    .sort((a, b) => a.left - b.left || a.right - b.right);
  // drop duplicate (left,right): last one wins
  const unique: IndexPair[] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (last && last.left === p.left && last.right === p.right) unique[unique.length - 1] = p;
    else unique.push(p);
  }
  if (unique.length === 0) return [];
  const chunks: IndexPair[][] = [];
  for (let i = 0; i < unique.length; i += KERN_PAIRS_PER_SUBTABLE) chunks.push(unique.slice(i, i + KERN_PAIRS_PER_SUBTABLE));

  const out: number[] = [];
  const u16 = (v: number) => out.push((v >> 8) & 0xff, v & 0xff);
  const i16 = (v: number) => u16(v < 0 ? v + 0x10000 : v);
  u16(0); // version
  u16(chunks.length);
  for (const chunk of chunks) {
    const n = chunk.length;
    const entrySelector = Math.floor(Math.log2(n));
    const searchRange = 6 * 2 ** entrySelector;
    u16(0); // subtable version
    u16(14 + 6 * n); // length
    u16(0x0001); // coverage: horizontal, format 0
    u16(n);
    u16(searchRange);
    u16(entrySelector);
    u16(6 * n - searchRange);
    for (const p of chunk) {
      u16(p.left);
      u16(p.right);
      i16(Math.max(-MAX_KERN_VALUE, Math.min(MAX_KERN_VALUE, Math.round(p.value))));
    }
  }
  return out;
}

export interface ParsedKerning {
  pairs: IndexPair[];
  warnings: string[];
}

/** Read the horizontal format-0 subtables of a `kern` table. Apple (version 1) tables are not supported. */
export function parseKernTable(bytes: ArrayLike<number> | ArrayBuffer): ParsedKerning {
  const u8 = toU8(bytes);
  const warnings: string[] = [];
  const pairs: IndexPair[] = [];
  if (u8.length < 4) return { pairs, warnings };
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  try {
    const version = dv.getUint16(0);
    if (version !== 0) {
      warnings.push('The kern table uses the Apple (version 1) layout, which is not editable; it is kept unchanged on export.');
      return { pairs, warnings };
    }
    const nTables = dv.getUint16(2);
    let off = 4;
    for (let t = 0; t < nTables; t++) {
      if (off + 6 > u8.length) break;
      const length = dv.getUint16(off + 2);
      const coverage = dv.getUint16(off + 4);
      const format = coverage >> 8;
      const horizontal = (coverage & 1) === 1;
      const crossStream = (coverage & 4) !== 0;
      if (format === 0 && horizontal && !crossStream) {
        const nPairs = dv.getUint16(off + 6);
        let p = off + 14;
        for (let i = 0; i < nPairs && p + 6 <= u8.length; i++, p += 6) {
          pairs.push({ left: dv.getUint16(p), right: dv.getUint16(p + 2), value: dv.getInt16(p + 4) });
        }
      } else if (format !== 0) {
        warnings.push(`A kern subtable of format ${format} was skipped (only format 0 is supported).`);
      }
      off += length || 6;
    }
  } catch {
    warnings.push('The kern table is damaged; its kerning could not be fully read.');
  }
  return { pairs, warnings };
}

// ---------------------------------------------------------------------------
// Binary: GPOS PairPos (feature "kern")
// ---------------------------------------------------------------------------

const VALUE_FORMAT_SIZE = (fmt: number): number => {
  let n = 0;
  for (let b = 0; b < 8; b++) if (fmt & (1 << b)) n += 2;
  return n;
};
/** Offset (bytes) of XAdvance inside a ValueRecord, or -1 when absent. */
const xAdvanceOffset = (fmt: number): number => {
  if (!(fmt & 0x0004)) return -1;
  let off = 0;
  if (fmt & 0x0001) off += 2;
  if (fmt & 0x0002) off += 2;
  return off;
};

function readCoverage(dv: DataView, off: number): number[] {
  const format = dv.getUint16(off);
  const out: number[] = [];
  if (format === 1) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) out.push(dv.getUint16(off + 4 + i * 2));
  } else if (format === 2) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) {
      const start = dv.getUint16(off + 4 + i * 6);
      const end = dv.getUint16(off + 6 + i * 6);
      for (let g = start; g <= end && out.length < 70000; g++) out.push(g);
    }
  }
  return out;
}

/** glyph → class (glyphs not listed are class 0). */
function readClassDef(dv: DataView, off: number): Map<number, number> {
  const format = dv.getUint16(off);
  const m = new Map<number, number>();
  if (format === 1) {
    const start = dv.getUint16(off + 2);
    const n = dv.getUint16(off + 4);
    for (let i = 0; i < n; i++) m.set(start + i, dv.getUint16(off + 6 + i * 2));
  } else if (format === 2) {
    const n = dv.getUint16(off + 2);
    for (let i = 0; i < n; i++) {
      const start = dv.getUint16(off + 4 + i * 6);
      const end = dv.getUint16(off + 6 + i * 6);
      const cls = dv.getUint16(off + 8 + i * 6);
      for (let g = start; g <= end && m.size < 70000; g++) m.set(g, cls);
    }
  }
  return m;
}

/** Read pair adjustments of the `kern` feature from a GPOS table. */
export function parseGposKerning(bytes: ArrayLike<number> | ArrayBuffer, maxPairs = MAX_EXPANDED_PAIRS): ParsedKerning {
  const u8 = toU8(bytes);
  const warnings: string[] = [];
  const pairs: IndexPair[] = [];
  const seen = new Set<number>();
  let truncated = false;
  if (u8.length < 10) return { pairs, warnings };
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  const add = (left: number, right: number, value: number): boolean => {
    if (value === 0) return true;
    const key = left * 65536 + right;
    if (seen.has(key)) return true; // the first matching lookup wins, as in a shaper
    if (pairs.length >= maxPairs) {
      truncated = true;
      return false;
    }
    seen.add(key);
    pairs.push({ left, right, value });
    return true;
  };

  try {
    const featureListOff = dv.getUint16(6);
    const lookupListOff = dv.getUint16(8);
    // lookups used by any "kern" feature
    const lookupIdx = new Set<number>();
    const featureCount = dv.getUint16(featureListOff);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureListOff + 2 + i * 6;
      const tag = String.fromCharCode(dv.getUint8(rec), dv.getUint8(rec + 1), dv.getUint8(rec + 2), dv.getUint8(rec + 3));
      if (tag !== 'kern') continue;
      const featOff = featureListOff + dv.getUint16(rec + 4);
      const nLookups = dv.getUint16(featOff + 2);
      for (let k = 0; k < nLookups; k++) lookupIdx.add(dv.getUint16(featOff + 4 + k * 2));
    }
    const lookupCount = dv.getUint16(lookupListOff);
    for (const li of [...lookupIdx].sort((a, b) => a - b)) {
      if (li >= lookupCount) continue;
      const lookupOff = lookupListOff + dv.getUint16(lookupListOff + 2 + li * 2);
      const lookupType = dv.getUint16(lookupOff);
      const subCount = dv.getUint16(lookupOff + 4);
      for (let s = 0; s < subCount; s++) {
        let sub = lookupOff + dv.getUint16(lookupOff + 6 + s * 2);
        if (lookupType === 9) {
          // extension positioning: format, extensionLookupType, 32-bit offset
          if (dv.getUint16(sub + 2) !== 2) continue;
          sub += dv.getUint32(sub + 4);
        } else if (lookupType !== 2) {
          continue;
        }
        const fmt = dv.getUint16(sub);
        const coverageOff = sub + dv.getUint16(sub + 2);
        const vf1 = dv.getUint16(sub + 4);
        const vf2 = dv.getUint16(sub + 6);
        const xa = xAdvanceOffset(vf1);
        if (xa < 0) continue; // this subtable adjusts something other than the advance
        const size1 = VALUE_FORMAT_SIZE(vf1);
        const size2 = VALUE_FORMAT_SIZE(vf2);
        if (fmt === 1) {
          const coverage = readCoverage(dv, coverageOff);
          const setCount = dv.getUint16(sub + 8);
          for (let i = 0; i < setCount && i < coverage.length; i++) {
            const setOff = sub + dv.getUint16(sub + 10 + i * 2);
            const n = dv.getUint16(setOff);
            let p = setOff + 2;
            for (let r = 0; r < n; r++, p += 2 + size1 + size2) {
              if (!add(coverage[i], dv.getUint16(p), dv.getInt16(p + 2 + xa))) break;
            }
          }
        } else if (fmt === 2) {
          const coverage = readCoverage(dv, coverageOff);
          const cd1 = readClassDef(dv, sub + dv.getUint16(sub + 8));
          const cd2 = readClassDef(dv, sub + dv.getUint16(sub + 10));
          const n1 = dv.getUint16(sub + 12);
          const n2 = dv.getUint16(sub + 14);
          const recSize = size1 + size2;
          const rightByClass = new Map<number, number[]>();
          for (const [g, c] of cd2) {
            if (c === 0) continue; // class 0 = "everything else"; never expanded
            const arr = rightByClass.get(c) ?? [];
            arr.push(g);
            rightByClass.set(c, arr);
          }
          outer: for (const lg of coverage) {
            const c1 = cd1.get(lg) ?? 0;
            if (c1 >= n1) continue;
            for (let c2 = 1; c2 < n2; c2++) {
              const rights = rightByClass.get(c2);
              if (!rights) continue;
              const v = dv.getInt16(sub + 16 + (c1 * n2 + c2) * recSize + xa);
              if (v === 0) continue;
              for (const rg of rights) if (!add(lg, rg, v)) break outer;
            }
          }
        }
      }
    }
  } catch {
    warnings.push('The GPOS table could not be fully read; some kerning pairs may be missing.');
  }
  if (truncated) warnings.push(`GPOS kerning was limited to the first ${maxPairs.toLocaleString()} pairs while reading.`);
  return { pairs, warnings };
}

// ---------------------------------------------------------------------------
// Import / export glue
// ---------------------------------------------------------------------------

/** Kerning pairs of a parsed source font (kern table first, then GPOS), keyed by glyph id. */
export function kerningFromTtf(
  ttf: { kern?: ArrayLike<number> | null; GPOS?: ArrayLike<number> | null },
  glyphs: GlyphDoc[],
  limit = MAX_IMPORTED_PAIRS,
): { pairs: KerningPair[]; warnings: string[] } | null {
  const hasKern = !!ttf.kern && ttf.kern.length > 0;
  const hasGpos = !!ttf.GPOS && ttf.GPOS.length > 0;
  if (!hasKern && !hasGpos) return null;
  const warnings: string[] = [];
  // GPOS is what shapers prefer when both exist, so it has priority
  const sources: ParsedKerning[] = [];
  if (hasGpos) sources.push(parseGposKerning(ttf.GPOS!));
  if (hasKern) sources.push(parseKernTable(ttf.kern!));
  const merged = new Map<number, IndexPair>();
  for (const src of sources) {
    warnings.push(...src.warnings);
    for (const p of src.pairs) {
      const key = p.left * 65536 + p.right;
      if (!merged.has(key)) merged.set(key, p);
    }
  }
  // Basic Latin pairs first, then Latin-1 / Latin Extended, then the rest, so a limit drops the least useful pairs
  const tier = (g: GlyphDoc): number => (g.unicode === null ? 3 : g.unicode < 0x80 ? 0 : g.unicode < 0x250 ? 1 : 2);
  const usable: Array<{ l: GlyphDoc; r: GlyphDoc; value: number; t: number }> = [];
  for (const p of merged.values()) {
    const l = glyphs[p.left];
    const r = glyphs[p.right];
    if (l && r) usable.push({ l, r, value: p.value, t: Math.max(tier(l), tier(r)) });
  }
  let kept = usable;
  if (usable.length > limit) {
    kept = usable
      .map((u, i) => ({ u, i }))
      .sort((a, b) => a.u.t - b.u.t || a.i - b.i)
      .slice(0, limit)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.u);
    warnings.push(
      `This font has ${usable.length.toLocaleString()} kerning pairs; the ${limit.toLocaleString()} most common (Latin first) were loaded. Unedited, the original kerning is exported untouched; once you edit kerning, only the loaded pairs are written.`,
    );
  }
  const out: KerningPair[] = kept.map((u) => ({ left: u.l.id, right: u.r.id, value: u.value }));
  if (out.length === 0 && warnings.length) return { pairs: [], warnings };
  return { pairs: out, warnings };
}

/** Pair list → glyph-index pairs for the document's current glyph order. */
export function kerningToIndexPairs(doc: FontDoc): IndexPair[] {
  const index = new Map(doc.glyphs.map((g, i) => [g.id, i]));
  const out: IndexPair[] = [];
  for (const p of effectivePairs(kerningOf(doc))) {
    const l = index.get(p.left);
    const r = index.get(p.right);
    if (l !== undefined && r !== undefined) out.push({ left: l, right: r, value: p.value });
  }
  return out;
}
