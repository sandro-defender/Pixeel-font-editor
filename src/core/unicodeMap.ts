/**
 * Multi-Unicode mappings: a glyph has one primary code point (`unicode`) plus
 * optional extra code points (`extraUnicodes`). Helpers here keep that pair
 * normalised and answer "which glyph owns this code point?".
 */
import type { FontDoc, GlyphDoc } from './types';

/** Every code point mapped to the glyph, primary first. */
export function allUnicodes(g: Pick<GlyphDoc, 'unicode' | 'extraUnicodes'>): number[] {
  if (g.unicode === null) return [];
  return g.extraUnicodes && g.extraUnicodes.length ? [g.unicode, ...g.extraUnicodes] : [g.unicode];
}

export const hasCodePoint = (g: Pick<GlyphDoc, 'unicode' | 'extraUnicodes'>, cp: number): boolean =>
  g.unicode === cp || (g.extraUnicodes?.includes(cp) ?? false);

export const mappingCount = (g: Pick<GlyphDoc, 'unicode' | 'extraUnicodes'>): number => allUnicodes(g).length;

/** First glyph (document order) that maps `cp`. */
export function glyphForCodePoint<T extends Pick<GlyphDoc, 'unicode' | 'extraUnicodes'>>(glyphs: T[], cp: number): T | undefined {
  return glyphs.find((g) => hasCodePoint(g, cp));
}

/** code point → glyph id (first owner wins). */
export function codePointIndex(doc: Pick<FontDoc, 'glyphs'>): Map<number, string> {
  const m = new Map<number, string>();
  for (const g of doc.glyphs) for (const cp of allUnicodes(g)) if (!m.has(cp)) m.set(cp, g.id);
  return m;
}

/** Same glyph with the mapping fields cleaned up (dedupe, promote when the primary is gone). */
export function normalizeMappings<T extends GlyphDoc>(g: T): T {
  const seen = new Set<number>();
  const list: number[] = [];
  for (const cp of [g.unicode, ...(g.extraUnicodes ?? [])]) {
    if (cp === null || cp === undefined || seen.has(cp)) continue;
    seen.add(cp);
    list.push(cp);
  }
  const unicode = list.length ? list[0] : null;
  const extra = list.slice(1);
  const next = { ...g, unicode } as T;
  if (extra.length) next.extraUnicodes = extra;
  else delete next.extraUnicodes;
  return next;
}

/** Remove one code point from a glyph; the first extra is promoted when the primary goes. */
export function withoutCodePoint<T extends GlyphDoc>(g: T, cp: number): T {
  if (!hasCodePoint(g, cp)) return g;
  return normalizeMappings({ ...g, unicode: g.unicode === cp ? (g.extraUnicodes?.[0] ?? null) : g.unicode, extraUnicodes: g.unicode === cp ? g.extraUnicodes?.slice(1) : g.extraUnicodes?.filter((x) => x !== cp) });
}

export interface MappingConflict {
  codePoint: number;
  ownerId: string;
  ownerName: string;
}

/** Which of `cps` are already mapped to a glyph other than `glyphId`? */
export function mappingConflicts(doc: Pick<FontDoc, 'glyphs'>, glyphId: string, cps: number[]): MappingConflict[] {
  const out: MappingConflict[] = [];
  for (const cp of cps) {
    const owner = doc.glyphs.find((g) => g.id !== glyphId && hasCodePoint(g, cp));
    if (owner) out.push({ codePoint: cp, ownerId: owner.id, ownerName: owner.name });
  }
  return out;
}

export const formatCp = (cp: number): string => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');

export interface DuplicateMapping {
  codePoint: number;
  owners: Array<{ id: string; name: string }>;
}

/**
 * Code points claimed by more than one glyph. The editor never creates these
 * (assigning a taken code point fails with a conflict), but a hand-edited
 * project file can, and a duplicate cannot be written to a cmap — so it is
 * detected explicitly instead of surfacing as a writer error.
 */
export function duplicateMappings(doc: Pick<FontDoc, 'glyphs'>): DuplicateMapping[] {
  const owners = new Map<number, Array<{ id: string; name: string }>>();
  for (const g of doc.glyphs) {
    for (const cp of allUnicodes(g)) {
      const list = owners.get(cp) ?? [];
      list.push({ id: g.id, name: g.name });
      owners.set(cp, list);
    }
  }
  const out: DuplicateMapping[] = [];
  for (const [codePoint, list] of owners) if (list.length > 1) out.push({ codePoint, owners: list });
  return out.sort((a, b) => a.codePoint - b.codePoint);
}
