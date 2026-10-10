/** Project save/load: a JSON document containing both fonts + settings. */
import type { FontDoc, ProjectFile, Slot, WorkspaceSettings } from './types';
import { getSource } from './sourceRegistry';
import type { TtfLike } from './fontCodec';

export const PROJECT_FORMAT = 'pixeel-project';
export const PROJECT_VERSION = 1 as const;

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
  if (parsed.project.version !== PROJECT_VERSION) {
    throw new Error(`Unsupported project version ${parsed.project.version}.`);
  }
  const sources: Record<string, TtfLike> = {};
  for (const [ref, ttf] of Object.entries(parsed.sources ?? {})) {
    if (ttf && typeof ttf === 'object' && Array.isArray((ttf as TtfLike).glyf)) sources[ref] = ttf;
  }
  return { project: parsed.project, sources };
}

export function projectFileBlob(data: SerializedProject): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
