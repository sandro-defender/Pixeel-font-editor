/** Local, same-origin reference fonts used by the glyph designer. */
import { joinBase } from '../core/basepath';

export interface ReferenceFontDefinition {
  id: string;
  name: string;
  /** Relative to public/fonts/. Only font files in that folder are allowed. */
  file: string;
}

interface FontCatalog {
  fonts: unknown[];
}

const loadedFaces = new Map<string, FontFace>();

function validFontFile(file: unknown): file is string {
  if (typeof file !== 'string' || !/\.(ttf|otf)$/i.test(file)) return false;
  if (file.startsWith('/') || file.includes('\\') || file.includes('?') || file.includes('#')) return false;
  const segments = file.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Fetch and validate `public/fonts/catalog.json` (the browser cannot list directories). */
export async function loadReferenceFontCatalog(): Promise<ReferenceFontDefinition[]> {
  const response = await fetch(joinBase(import.meta.env.BASE_URL, 'fonts/catalog.json'), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Font catalog request failed (${response.status}).`);
  const raw = (await response.json()) as Partial<FontCatalog>;
  if (!raw || !Array.isArray(raw.fonts)) throw new Error('Font catalog must contain a "fonts" array.');

  const seen = new Set<string>();
  const fonts: ReferenceFontDefinition[] = [];
  for (const entry of raw.fonts) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (
      typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(item.id) ||
      typeof item.name !== 'string' || item.name.trim().length === 0 || item.name.length > 120 ||
      !validFontFile(item.file) || seen.has(item.id)
    ) continue;
    seen.add(item.id);
    fonts.push({ id: item.id, name: item.name.trim(), file: item.file });
  }
  return fonts;
}

function familyFor(id: string): string {
  return `PixeelReference_${id.replace(/[^a-z0-9_-]/gi, '_')}`;
}

async function addFontFace(id: string, source: string | ArrayBuffer): Promise<string> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) {
    throw new Error('This browser cannot load a local font preview. Try a current version of Chrome, Firefox, Safari or Edge.');
  }
  const existing = loadedFaces.get(id);
  if (existing) {
    if (existing.status !== 'loaded') await existing.load();
    return familyFor(id);
  }

  const face = new FontFace(familyFor(id), source, { style: 'normal', weight: '400' });
  loadedFaces.set(id, face);
  try {
    await face.load();
    document.fonts.add(face);
    return familyFor(id);
  } catch (error) {
    loadedFaces.delete(id);
    throw new Error(`Could not load the reference font: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Load a font kept in public/fonts/, respecting Vite/GitHub Pages base paths. */
export function loadCatalogReferenceFont(font: ReferenceFontDefinition): Promise<string> {
  const encodedFile = font.file.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const url = joinBase(import.meta.env.BASE_URL, `fonts/${encodedFile}`);
  return addFontFace(`catalog-${font.id}`, `url("${url}")`);
}

/** Load a user-picked TTF/OTF from bytes without uploading it anywhere. */
export function loadUploadedReferenceFont(id: string, bytes: ArrayBuffer): Promise<string> {
  return addFontFace(`upload-${id}`, bytes);
}
