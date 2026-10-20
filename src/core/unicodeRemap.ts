/**
 * Bulk Unicode remapping for selected glyphs.
 *
 * A remap changes only cmap assignments: outlines, pixels, names and metrics
 * stay with their glyphs. In "move" mode the old code points are removed;
 * "alias" keeps them as extra mappings. Taking a target code point from another
 * glyph only removes that one mapping — the other glyph and its artwork remain.
 */
import type { FontDoc, GlyphDoc } from './types';
import { allUnicodes, normalizeMappings, withoutCodePoint } from './unicodeMap';
import { GEORGIAN_MKHEDRULI_POINTS } from './charSets';
import { GEORGIAN_LETTER_POINTS, isValidCodePoint } from './unicodeNames';

export type UnicodeRemapPreset =
  | 'digits'
  | 'latinUpper'
  | 'latinLower'
  | 'georgian'
  | 'georgianAll'
  | 'ascii'
  | 'custom';

export type UnicodeRemapMode = 'move' | 'alias';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The destination sets offered by the bulk remapping dialog. */
export const UNICODE_REMAP_PRESETS: Array<{
  id: UnicodeRemapPreset;
  label: string;
  description: string;
  points?: number[];
}> = [
  { id: 'digits', label: 'ASCII digits (0–9)', description: 'U+0030–U+0039', points: range(0x30, 0x39) },
  { id: 'latinUpper', label: 'ASCII uppercase (A–Z)', description: 'U+0041–U+005A', points: range(0x41, 0x5a) },
  { id: 'latinLower', label: 'ASCII lowercase (a–z)', description: 'U+0061–U+007A', points: range(0x61, 0x7a) },
  { id: 'georgian', label: 'Georgian Mkhedruli (ა–ჰ)', description: '33 modern letters · U+10D0–U+10F0', points: [...GEORGIAN_MKHEDRULI_POINTS] },
  { id: 'georgianAll', label: 'All Georgian letters', description: '172 assigned letters across four scripts', points: [...GEORGIAN_LETTER_POINTS] },
  { id: 'ascii', label: 'Printable ASCII', description: 'Space through tilde · U+0020–U+007E', points: range(0x20, 0x7e) },
  { id: 'custom', label: 'Custom Unicode range', description: 'Choose the first code point; selected glyphs fill the range in order.' },
];

export interface UnicodeRemapConflict {
  codePoint: number;
  ownerId: string;
  ownerName: string;
  targetGlyphId: string;
  targetGlyphName: string;
}

export interface UnicodeRemapOptions {
  mode?: UnicodeRemapMode;
  /** Explicitly unmap target code points from their current owners. */
  takeExistingMappings?: boolean;
}

/** Generate `count` destination code points from a preset or custom start. */
export function unicodeRemapTargets(
  preset: UnicodeRemapPreset,
  count: number,
  customStart?: number,
): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Select at least one glyph to remap.');
  const def = UNICODE_REMAP_PRESETS.find((x) => x.id === preset);
  if (!def) throw new Error('Choose a destination character set.');
  if (preset !== 'custom') {
    const points = def.points ?? [];
    if (count > points.length) {
      throw new Error(`${def.label} contains ${points.length} code points; ${count} glyphs are selected.`);
    }
    return points.slice(0, count);
  }
  if (customStart === undefined || !isValidCodePoint(customStart)) {
    throw new Error('Enter a valid Unicode code point for the start of the range.');
  }
  const targets = Array.from({ length: count }, (_, i) => customStart + i);
  const invalid = targets.find((cp) => !isValidCodePoint(cp));
  if (invalid !== undefined) {
    throw new Error('That range goes past U+10FFFF or crosses the reserved surrogate area. Choose an earlier start.');
  }
  return targets;
}

/**
 * Find target code points currently owned by a different glyph. In move mode,
 * selected glyphs are considered free because their old mappings will be
 * replaced together. In alias mode, a selected glyph still owns its mappings.
 */
export function findUnicodeRemapConflicts(
  doc: Pick<FontDoc, 'glyphs'>,
  glyphIds: string[],
  targetPoints: number[],
  mode: UnicodeRemapMode = 'move',
): UnicodeRemapConflict[] {
  const selected = new Set(glyphIds);
  const out: UnicodeRemapConflict[] = [];
  for (let i = 0; i < targetPoints.length; i++) {
    const cp = targetPoints[i];
    const target = doc.glyphs.find((g) => g.id === glyphIds[i]);
    if (!target) continue;
    for (const owner of doc.glyphs) {
      if (owner.id === target.id || !allUnicodes(owner).includes(cp)) continue;
      if (mode === 'move' && selected.has(owner.id)) continue;
      out.push({
        codePoint: cp,
        ownerId: owner.id,
        ownerName: owner.name,
        targetGlyphId: target.id,
        targetGlyphName: target.name,
      });
    }
  }
  return out;
}

function validatedSelection(doc: FontDoc, glyphIds: string[], targetPoints: number[]): GlyphDoc[] {
  if (glyphIds.length === 0) throw new Error('Select at least one glyph to remap.');
  if (glyphIds.length !== targetPoints.length) throw new Error('There must be exactly one destination code point per selected glyph.');
  if (new Set(glyphIds).size !== glyphIds.length) throw new Error('A glyph is selected more than once.');
  if (new Set(targetPoints).size !== targetPoints.length) throw new Error('Two selected glyphs cannot share the same destination code point.');
  for (const cp of targetPoints) {
    if (!isValidCodePoint(cp)) throw new Error(`U+${Number(cp).toString(16).toUpperCase()} is not a valid Unicode code point.`);
  }
  const selected = glyphIds.map((id) => doc.glyphs.find((g) => g.id === id));
  if (selected.some((g) => !g)) throw new Error('One or more selected glyphs no longer exist.');
  const glyphs = selected as GlyphDoc[];
  if (glyphs.some((g) => g.name === '.notdef')) throw new Error('.notdef cannot be remapped. Remove it from the selection first.');
  return glyphs;
}

/**
 * Reassign the chosen glyphs to the supplied code points in their given order.
 * The whole batch is a pure, single-document update and can be committed as one
 * undo step by the store.
 */
export function remapGlyphs(
  doc: FontDoc,
  glyphIds: string[],
  targetPoints: number[],
  options: UnicodeRemapOptions = {},
): FontDoc {
  const mode = options.mode ?? 'move';
  validatedSelection(doc, glyphIds, targetPoints);
  const conflicts = findUnicodeRemapConflicts(doc, glyphIds, targetPoints, mode);
  if (conflicts.length && !options.takeExistingMappings) {
    const conflict = conflicts[0];
    throw new Error(`${formatCodePoint(conflict.codePoint)} is already mapped to “${conflict.ownerName}”. Confirm that you want to take the existing mapping first.`);
  }
  if (conflicts.some((c) => c.ownerName === '.notdef')) {
    throw new Error('.notdef must stay unmapped, so its code point cannot be taken.');
  }

  const targetForGlyph = new Map(glyphIds.map((id, i) => [id, targetPoints[i]]));
  const conflictCodesByOwner = new Map<string, Set<number>>();
  for (const conflict of conflicts) {
    const codes = conflictCodesByOwner.get(conflict.ownerId) ?? new Set<number>();
    codes.add(conflict.codePoint);
    conflictCodesByOwner.set(conflict.ownerId, codes);
  }
  let changed = false;

  const glyphs = doc.glyphs.map((glyph) => {
    let next = glyph;
    const codesToTake = conflictCodesByOwner.get(glyph.id);
    if (codesToTake) {
      for (const cp of codesToTake) next = withoutCodePoint(next, cp);
    }

    const target = targetForGlyph.get(glyph.id);
    if (target !== undefined) {
      if (mode === 'move') {
        if (allUnicodes(next).length !== 1 || next.unicode !== target) {
          next = normalizeMappings({ ...next, unicode: target, extraUnicodes: undefined });
        }
      } else if (!allUnicodes(next).includes(target)) {
        next = normalizeMappings({ ...next, unicode: next.unicode ?? target, extraUnicodes: next.unicode === null ? undefined : [...(next.extraUnicodes ?? []), target] });
      }
    }

    if (next !== glyph) changed = true;
    return next;
  });

  if (!changed) return doc;
  return { ...doc, glyphs };
}

/** Format a code point without depending on UI utilities. */
export function formatCodePoint(cp: number): string {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}
