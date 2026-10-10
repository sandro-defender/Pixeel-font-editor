/** Pixel-oriented character sampling and style helpers for the local glyph designer. */
import { Bitmap } from './bitmap';

export interface GlyphDesignStyle {
  /** Percentage width, centered on the glyph cell. */
  width: number;
  /** Percentage height, scaled around the baseline. */
  height: number;
  /** Italic shear in degrees. */
  slant: number;
  /** Number of pixels to grow the ink by. */
  weight: number;
  /** Vertical nudge in pixels; positive moves ink up. */
  verticalShift: number;
}

export const DEFAULT_GLYPH_DESIGN_STYLE: GlyphDesignStyle = {
  width: 100,
  height: 100,
  slant: 0,
  weight: 0,
  verticalShift: 0,
};

const SUPERSAMPLE = 4;
const REFERENCE_FONT_SIZE = 1000;

function cssFontFamily(family: string): string {
  // Generic CSS families must remain unquoted; font-face names are quoted so
  // spaces and punctuation in a user-provided family name stay unambiguous.
  if (family === 'sans-serif' || family === 'serif' || family === 'monospace' || family === 'system-ui') return family;
  return `"${family.replace(/[\\"]/g, '\\$&')}"`;
}

/**
 * Rasterize one Unicode character from a browser-loaded local font onto the
 * target glyph's grid. The browser's font fallback chain handles missing
 * glyphs; callers should show the preview so a tofu/missing character is
 * visible before applying it.
 */
export function rasterizeCharacterTemplate(
  character: string,
  fontFamily: string,
  width: number,
  height: number,
  baselineRow: number,
): Bitmap {
  if ([...character].length !== 1) throw new Error('Choose exactly one template character.');
  if (character === ' ' || character === '\u00a0') throw new Error('A space has no pixels to copy. Choose a visible character.');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('The target pixel grid is invalid.');
  if (typeof document === 'undefined') throw new Error('Character preview needs a browser canvas.');

  const scale = SUPERSAMPLE;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser could not create a 2D canvas for the character preview.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000';
  context.textAlign = 'center';
  context.textBaseline = 'alphabetic';
  const family = cssFontFamily(fontFamily);
  context.font = `400 ${REFERENCE_FONT_SIZE}px ${family}, sans-serif`;
  const metrics = context.measureText(character);
  const inkWidth = Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight || metrics.width);
  const ascent = Math.max(1, metrics.actualBoundingBoxAscent || REFERENCE_FONT_SIZE * 0.72);
  const descent = Math.max(0, metrics.actualBoundingBoxDescent || 0);

  // Keep a little breathing room while respecting the selected pixel font's
  // baseline. Descent is allowed to clip slightly on grids with no descender
  // rows instead of shrinking every ordinary letter to nothing.
  const availableWidth = Math.max(scale, (width - 1.5) * scale);
  const availableAbove = Math.max(scale, (height - baselineRow - 0.45) * scale);
  const availableBelow = Math.max(0, (baselineRow - 0.25) * scale);
  const factors = [availableWidth / inkWidth, availableAbove / ascent];
  if (descent > 0 && availableBelow > 0) factors.push(availableBelow / descent);
  const fit = Math.min(...factors);
  const fontSize = Math.max(1, REFERENCE_FONT_SIZE * fit);
  context.font = `400 ${fontSize}px ${family}, sans-serif`;
  context.fillText(character, canvas.width / 2, (height - baselineRow) * scale);

  const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bitmap = new Bitmap(width, height);
  const area = scale * scale;
  // Antialiasing is averaged over 4×4 subpixels. A modest threshold keeps
  // thin strokes while avoiding one faint antialiased fringe pixel per edge.
  const coverageThreshold = 0.2;
  for (let screenY = 0; screenY < height; screenY++) {
    for (let x = 0; x < width; x++) {
      let alpha = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const index = (((screenY * scale + sy) * canvas.width) + x * scale + sx) * 4 + 3;
          alpha += image[index];
        }
      }
      if (alpha / (area * 255) >= coverageThreshold) bitmap.set(x, height - 1 - screenY, 1);
    }
  }
  if (bitmap.isEmpty()) throw new Error('No pixels were produced for that character. Try a font that contains it or choose another template.');
  return bitmap;
}

/** Apply the designer sliders to a raster template without smoothing pixel edges. */
export function styleGlyphTemplate(source: Bitmap, baselineRow: number, style: GlyphDesignStyle): Bitmap {
  const widthScale = Math.max(0.2, style.width / 100);
  const heightScale = Math.max(0.2, style.height / 100);
  const shear = Math.tan((style.slant * Math.PI) / 180);
  const baseline = Math.max(0, Math.min(source.height - 1, baselineRow));
  const centerX = (source.width - 1) / 2;
  const out = new Bitmap(source.width, source.height);

  // Inverse-map each output cell. This keeps stretched strokes continuous and
  // makes the baseline stay still as height and slant change.
  for (let y = 0; y < out.height; y++) {
    const sourceY = baseline + (y - baseline - style.verticalShift) / heightScale;
    const iy = Math.round(sourceY);
    if (iy < 0 || iy >= source.height) continue;
    for (let x = 0; x < out.width; x++) {
      const sourceX = centerX + (x - centerX - shear * (sourceY - baseline)) / widthScale;
      const ix = Math.round(sourceX);
      if (source.get(ix, iy)) out.set(x, y, 1);
    }
  }

  const weight = Math.max(0, Math.min(4, Math.round(style.weight)));
  if (weight === 0 || out.isEmpty()) return out;
  const thick = new Bitmap(out.width, out.height);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (!out.get(x, y)) continue;
      for (let dy = -weight; dy <= weight; dy++) {
        for (let dx = -weight; dx <= weight; dx++) {
          // A circular brush adds weight without turning diagonal strokes into
          // a disproportionately heavy square block.
          if (dx * dx + dy * dy <= weight * weight + 0.25) thick.set(x + dx, y + dy, 1);
        }
      }
    }
  }
  return thick;
}

/** SVG path for small accessible previews (one rectangle per lit pixel). */
export function bitmapToSvgPath(bitmap: Bitmap): string {
  const parts: string[] = [];
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      if (bitmap.get(x, y)) parts.push(`M${x} ${bitmap.height - 1 - y}h1v1h-1z`);
    }
  }
  return parts.join('');
}
