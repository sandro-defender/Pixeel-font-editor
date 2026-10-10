/**
 * Drag-and-drop of glyph cards onto the Font A / Font B tabs.
 * The MIME type encodes the source font, because browsers only expose the
 * type list (not the payload) during dragover.
 */
import type { Slot } from '../core/types';

export function glyphDragType(from: Slot): string {
  return `application/x-pixeel-glyphs-${from.toLowerCase()}`;
}

export function readGlyphDrag(dt: DataTransfer | null, from: Slot): string[] | null {
  if (!dt) return null;
  const raw = dt.getData(glyphDragType(from));
  if (!raw) return null;
  try {
    const ids = JSON.parse(raw);
    return Array.isArray(ids) && ids.every((x) => typeof x === 'string') ? ids : null;
  } catch {
    return null;
  }
}

/** Whether a drag started in the other font (so it can be dropped on this tab). */
export function dragFromOther(dt: DataTransfer | null, target: Slot): Slot | null {
  if (!dt) return null;
  const from: Slot = target === 'A' ? 'B' : 'A';
  return dt.types.includes(glyphDragType(from)) ? from : null;
}
