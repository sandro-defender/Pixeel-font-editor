/**
 * Composite glyph builder: pure edits of a glyph's component list.
 *
 * A composite stores `compound` (components referencing other glyphs by id) plus
 * cached flattened `contours` for display. Export keeps it as a composite while
 * every component still exists. Component transform: x' = a·x + c·y + e,
 * y' = b·x + d·y + f; the builder edits e/f (offset) and a/d (scale).
 */
import type { CompoundComponent, Contour, FontDoc, GlyphDoc } from './types';
import { contourBounds, transformContours } from './contours';
import { flattenComponents, resolveGlyphContours } from './fontCodec';

/** TrueType stores component scales as F2Dot14: −2 ≤ scale < 2. */
export const MAX_COMPONENT_SCALE = 1.999;
export const MAX_COMPONENT_OFFSET = 0x7fff;

export interface ComponentPatch {
  glyphId?: string;
  dx?: number;
  dy?: number;
  scaleX?: number;
  scaleY?: number;
  useMyMetrics?: boolean;
}

const find = (doc: FontDoc, id: string): GlyphDoc | undefined => doc.glyphs.find((g) => g.id === id);

/** Does glyph `id` (directly or through other composites) use glyph `target`? */
export function dependsOn(doc: Pick<FontDoc, 'glyphs'>, id: string, target: string, seen: Set<string> = new Set()): boolean {
  if (id === target) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  const g = doc.glyphs.find((x) => x.id === id);
  if (!g || g.kind !== 'compound' || !g.compound) return false;
  return g.compound.some((c) => !!c.glyphId && dependsOn(doc, c.glyphId, target, seen));
}

/** Why `componentId` cannot be a component of `compositeId` (null = fine). */
export function componentProblem(doc: FontDoc, compositeId: string, componentId: string): string | null {
  const comp = find(doc, componentId);
  if (!comp) return 'That glyph does not exist.';
  if (componentId === compositeId) return 'A glyph cannot contain itself.';
  if (comp.name === '.notdef') return '.notdef cannot be used as a component.';
  if (dependsOn(doc, componentId, compositeId)) return `“${comp.name}” already contains this glyph — that would be a loop.`;
  return null;
}

/** Glyphs that can be added as components of `compositeId`. */
export function availableComponents(doc: FontDoc, compositeId: string): GlyphDoc[] {
  return doc.glyphs.filter((g) => !componentProblem(doc, compositeId, g.id) && (g.kind !== 'empty' || g.contours.length > 0));
}

const identity = (e = 0, f = 0, a = 1, d = 1) => ({ a, b: 0, c: 0, d, e, f });

function checkOffset(v: number, label: string): number {
  if (!Number.isFinite(v) || Math.abs(v) > MAX_COMPONENT_OFFSET) throw new Error(`${label} must be a number within ±${MAX_COMPONENT_OFFSET}.`);
  return Math.round(v);
}

function checkScale(v: number, label: string): number {
  if (!Number.isFinite(v) || v === 0 || Math.abs(v) > MAX_COMPONENT_SCALE) {
    throw new Error(`${label} must be non-zero and between −${MAX_COMPONENT_SCALE} and ${MAX_COMPONENT_SCALE} (TrueType stores scales as F2Dot14).`);
  }
  return Math.round(v * 16384) / 16384; // what F2Dot14 can hold
}

/** Replace the composite's component list and refresh its cached outline and left side bearing. */
function withComponents(doc: FontDoc, glyphId: string, comps: CompoundComponent[]): FontDoc {
  const glyphs = doc.glyphs.map((g) => (g.id === glyphId ? { ...g, kind: 'compound' as const, compound: comps, pixel: null } : g));
  const contours = flattenComponents(glyphs, comps, new Set());
  const bb = contourBounds(contours);
  return {
    ...doc,
    glyphs: glyphs.map((g) =>
      g.id === glyphId
        ? { ...g, contours, leftSideBearing: bb ? bb.xMin : g.leftSideBearing, edited: true, instructions: null }
        : g,
    ),
  };
}

function compositeOf(doc: FontDoc, glyphId: string): GlyphDoc {
  const g = find(doc, glyphId);
  if (!g) throw new Error('Unknown glyph.');
  if (g.kind !== 'compound' || !g.compound) throw new Error(`“${g.name}” is not a composite glyph.`);
  return g;
}

/** Turn a glyph into an (initially empty) composite; its own outline or pixels are discarded. */
export function startComposite(doc: FontDoc, glyphId: string): FontDoc {
  const g = find(doc, glyphId);
  if (!g) throw new Error('Unknown glyph.');
  if (g.name === '.notdef') throw new Error('.notdef cannot be a composite.');
  if (doc.ledMatrix) throw new Error('LED matrix fonts cannot contain composites (every glyph must be exact pixels).');
  if (g.kind === 'compound') return doc;
  return {
    ...doc,
    glyphs: doc.glyphs.map((x) =>
      x.id === glyphId ? { ...x, kind: 'compound' as const, compound: [], contours: [], pixel: null, sourceContours: x.sourceContours, edited: true, instructions: null } : x,
    ),
  };
}

/** Does the glyph have its own ink that converting to a composite would discard? */
export function hasOwnArtwork(g: GlyphDoc): boolean {
  if (g.kind === 'compound') return false;
  if (g.pixel && g.pixel.cellsB64) {
    try {
      return Array.from(atob(g.pixel.cellsB64)).some((ch) => ch.charCodeAt(0) !== 0);
    } catch {
      return true;
    }
  }
  return g.contours.length > 0;
}

export function addComponent(doc: FontDoc, glyphId: string, componentId: string, opts: { dx?: number; dy?: number; scaleX?: number; scaleY?: number } = {}): FontDoc {
  const g = compositeOf(doc, glyphId);
  const problem = componentProblem(doc, glyphId, componentId);
  if (problem) throw new Error(problem);
  const target = find(doc, componentId)!;
  const comp: CompoundComponent = {
    srcGlyphIndex: doc.glyphs.indexOf(target),
    glyphId: componentId,
    transform: identity(
      checkOffset(opts.dx ?? 0, 'Offset X'),
      checkOffset(opts.dy ?? 0, 'Offset Y'),
      checkScale(opts.scaleX ?? 1, 'Scale X'),
      checkScale(opts.scaleY ?? opts.scaleX ?? 1, 'Scale Y'),
    ),
  };
  return withComponents(doc, glyphId, [...g.compound!, comp]);
}

export function removeComponent(doc: FontDoc, glyphId: string, index: number): FontDoc {
  const g = compositeOf(doc, glyphId);
  if (index < 0 || index >= g.compound!.length) throw new Error('No such component.');
  return withComponents(doc, glyphId, g.compound!.filter((_, i) => i !== index));
}

export function updateComponent(doc: FontDoc, glyphId: string, index: number, patch: ComponentPatch): FontDoc {
  const g = compositeOf(doc, glyphId);
  const cur = g.compound![index];
  if (!cur) throw new Error('No such component.');
  let next: CompoundComponent = { ...cur, transform: { ...cur.transform } };
  if (patch.glyphId !== undefined && patch.glyphId !== cur.glyphId) {
    const problem = componentProblem(doc, glyphId, patch.glyphId);
    if (problem) throw new Error(problem);
    next.glyphId = patch.glyphId;
    next.srcGlyphIndex = doc.glyphs.findIndex((x) => x.id === patch.glyphId);
  }
  if (patch.dx !== undefined) next.transform.e = checkOffset(patch.dx, 'Offset X');
  if (patch.dy !== undefined) next.transform.f = checkOffset(patch.dy, 'Offset Y');
  if (patch.scaleX !== undefined) next.transform.a = checkScale(patch.scaleX, 'Scale X');
  if (patch.scaleY !== undefined) next.transform.d = checkScale(patch.scaleY, 'Scale Y');
  if (patch.useMyMetrics !== undefined) next.useMyMetrics = patch.useMyMetrics;
  return withComponents(doc, glyphId, g.compound!.map((c, i) => (i === index ? next : c)));
}

/** Change the stacking / export order of a component. */
export function moveComponent(doc: FontDoc, glyphId: string, from: number, to: number): FontDoc {
  const g = compositeOf(doc, glyphId);
  const list = [...g.compound!];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) throw new Error('No such component.');
  if (from === to) return doc;
  const [c] = list.splice(from, 1);
  list.splice(to, 0, c);
  return withComponents(doc, glyphId, list);
}

/** Set the composite's advance width to its first component's (the base letter's). */
export function matchBaseAdvance(doc: FontDoc, glyphId: string): FontDoc {
  const g = compositeOf(doc, glyphId);
  const base = g.compound!.map((c) => (c.glyphId ? find(doc, c.glyphId) : undefined)).find(Boolean);
  if (!base) throw new Error('Add a component first.');
  return { ...doc, glyphs: doc.glyphs.map((x) => (x.id === glyphId ? { ...x, advanceWidth: base.advanceWidth, edited: true } : x)) };
}

/** One component's outline in the composite's coordinates (for the builder canvas). */
export function componentContours(doc: FontDoc, comp: CompoundComponent): Contour[] {
  const target = comp.glyphId ? find(doc, comp.glyphId) : undefined;
  if (!target) return [];
  return transformContours(resolveGlyphContours(target, doc.glyphs), comp.transform);
}

export interface ComponentInfo {
  index: number;
  comp: CompoundComponent;
  glyph: GlyphDoc | undefined;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  /** b or c is non-zero (an imported rotation/skew): the builder keeps it but cannot edit it. */
  skewed: boolean;
}

export function componentInfos(doc: FontDoc, g: GlyphDoc): ComponentInfo[] {
  return (g.compound ?? []).map((comp, index) => ({
    index,
    comp,
    glyph: comp.glyphId ? find(doc, comp.glyphId) : undefined,
    dx: comp.transform.e,
    dy: comp.transform.f,
    scaleX: comp.transform.a,
    scaleY: comp.transform.d,
    skewed: comp.transform.b !== 0 || comp.transform.c !== 0,
  }));
}
