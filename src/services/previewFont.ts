/**
 * Live preview fonts: rebuild the edited font, register it via @font-face and
 * hand back a family name. Old object URLs / style nodes are released.
 */
import { buildPreviewFont } from './exportService';
import type { FontDoc, Slot } from '../core/types';

interface PreviewEntry {
  family: string;
  url: string;
  styleEl: HTMLStyleElement;
  version: number;
}

const previews: Record<Slot, PreviewEntry | null> = { A: null, B: null };
let counter = 0;
let buildChain: Promise<unknown> = Promise.resolve();

export function previewFamily(slot: Slot): string | null {
  return previews[slot]?.family ?? null;
}

/**
 * Rebuild the preview font for a slot. Builds are serialized on a promise
 * chain; the latest build always wins because entries are replaced in order.
 */
export function rebuildPreview(slot: Slot, doc: FontDoc): Promise<string | null> {
  const version = ++counter;
  buildChain = buildChain.then(async () => {
    // a newer request arrived while this one was queued: its result would be thrown away
    if (version !== counter) return;
    try {
      const buffer = await buildPreviewFont(doc, `PV${version}`);
      if (version !== counter) return; // superseded while building
      const family = `PixeelPreview-${slot}-${version}`;
      const blob = new Blob([buffer], { type: 'font/ttf' });
      const url = URL.createObjectURL(blob);
      const styleEl = document.createElement('style');
      styleEl.textContent = `@font-face { font-family: "${family}"; src: url("${url}"); font-display: block; }`;
      document.head.appendChild(styleEl);
      // preload before exposing so text doesn't flash blank
      if ('fonts' in document) {
        try {
          await (document as Document & { fonts: FontFaceSet }).fonts.load('16px "' + family + '"');
        } catch {
          /* non-fatal */
        }
      }
      releasePreview(slot); // revoke previous object URL + style node
      previews[slot] = { family, url, styleEl, version };
    } catch (err) {
      console.warn('preview build failed', err);
    }
  });
  return buildChain.then(() => previews[slot]?.family ?? null);
}

export function releasePreview(slot: Slot): void {
  const p = previews[slot];
  if (!p) return;
  URL.revokeObjectURL(p.url);
  p.styleEl.remove();
  previews[slot] = null;
}

export function releaseAllPreviews(): void {
  releasePreview('A');
  releasePreview('B');
}
