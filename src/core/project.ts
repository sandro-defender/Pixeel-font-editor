/** Project save/load: a JSON document containing both fonts + settings. */
import type { FontDoc, ProjectFile, Slot, WorkspaceSettings } from './types';
import { altMappingIssue } from './charSets';
import { getSource } from './sourceRegistry';
import type { TtfLike } from './fontCodec';

export const PROJECT_FORMAT = 'pixeel-project';
export const PROJECT_VERSION = 1 as const;

/** Oldest project format this build still opens (1 = the only one so far). */
export const MIN_PROJECT_VERSION = 1;

export interface SerializedProject {
  project: ProjectFile;
  /** Source ttf objects keyed by sourceRef (only for imported fonts). */
  sources: Record<string, TtfLike>;
}

export function serializeProject(
  fonts: { A: FontDoc | null; B: FontDoc | null },
  active: Slot,
  settings: WorkspaceSettings,
): SerializedProject {
  const sources: Record<string, TtfLike> = {};
  for (const slot of ['A', 'B'] as Slot[]) {
    const f = fonts[slot];
    if (f?.sourceRef) {
      const ttf = getSource(f.sourceRef);
      if (ttf) sources[f.sourceRef] = ttf;
    }
  }
  return {
    project: {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      savedAt: Date.now(),
      fonts: { A: fonts.A, B: fonts.B },
      active,
      settings,
    },
    sources,
  };
}

export interface DeserializedProject {
  project: ProjectFile;
  /** Source ttf objects from the file, keyed by the sourceRef they had in the file. Nothing is registered here. */
  sources: Record<string, TtfLike>;
}

/** Parse and validate a project file. Pure: it does not touch the source registry. */
export function deserializeProject(json: string): DeserializedProject {
  let parsed: SerializedProject;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Not a valid Pixeel project file (invalid JSON).');
  }
  if (!parsed || parsed.project?.format !== PROJECT_FORMAT) {
    throw new Error('Not a valid Pixeel project file (missing pixeel-project marker).');
  }
  if (typeof parsed.project.version !== 'number') {
    throw new Error('Not a valid Pixeel project file (missing version).');
  }
  const project = migrateProject(parsed.project);
  const sources: Record<string, TtfLike> = {};
  for (const [ref, ttf] of Object.entries(parsed.sources ?? {})) {
    if (ttf && typeof ttf === 'object' && Array.isArray((ttf as TtfLike).glyf)) sources[ref] = ttf;
  }
  return { project, sources };
}

// ---------------------------------------------------------------------------
// Migration / normalisation
// ---------------------------------------------------------------------------

/**
 * Bring one font document up to the current shapes without deleting anything.
 *
 * Everything added after the first release is optional (glyph origin, the
 * alternative-digit mapping), so an older `.pixeel.json` keeps working: the
 * missing metadata is initialised here and every existing glyph, mapping and
 * metric is left exactly as it was.
 */
export function normalizeFontDoc(font: FontDoc): FontDoc {
  const glyphs = (font.glyphs ?? []).map((g) => {
    if (g.origin) return g;
    // glyphs read from a source file have a source index; glyphs drawn here do not
    return g.srcIndex !== null && g.srcIndex !== undefined ? { ...g, origin: 'imported' as const } : g;
  });
  // A mapping that does not satisfy the shared rules (wrong length, duplicates,
  // control/standard code points …) falls back to the default PUA mapping: the
  // project still opens, and no glyph is ever deleted because of it.
  const altDigits = font.altDigits && !altMappingIssue(font.altDigits.codepoints) ? { codepoints: font.altDigits.codepoints.map((cp) => Math.round(cp)) } : null;
  const out: FontDoc = { ...font, glyphs };
  if (altDigits) out.altDigits = altDigits;
  else delete out.altDigits;
  return out;
}

/**
 * Validate and migrate a parsed project object. Unknown/newer versions are
 * rejected; known ones are normalised field by field (never replaced wholesale,
 * so data this build does not understand survives a save→load round trip).
 */
export function migrateProject(project: ProjectFile): ProjectFile {
  if (project.version > PROJECT_VERSION) {
    throw new Error(
      `This project was saved with a newer Pixeel (format ${project.version}); this build understands up to ${PROJECT_VERSION}.`,
    );
  }
  if (project.version < MIN_PROJECT_VERSION) {
    throw new Error(`Unsupported project version ${project.version}.`);
  }
  const fix = (font: FontDoc | null | undefined): FontDoc | null => (font ? normalizeFontDoc(font) : null);
  return {
    ...project,
    version: PROJECT_VERSION,
    fonts: { A: fix(project.fonts?.A), B: fix(project.fonts?.B) },
  };
}

export function projectFileBlob(data: SerializedProject): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
