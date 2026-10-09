/** Project save/load: a JSON document containing both fonts + settings. */
import type { FontDoc, ProjectFile, Slot, WorkspaceSettings } from './types';
import { getSource, registerSource } from './sourceRegistry';
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
  /** New sourceRef values mapped old→new (registry entries re-registered). */
  restoredSources: number;
}

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
  const { project, sources = {} } = parsed;
  let restored = 0;
  const remap: Record<string, string> = {};
  for (const [ref, ttf] of Object.entries(sources)) {
    if (ttf && typeof ttf === 'object' && Array.isArray((ttf as TtfLike).glyf)) {
      const newRef = registerSource(ttf);
      remap[ref] = newRef;
      restored += 1;
    }
  }
  for (const slot of ['A', 'B'] as Slot[]) {
    const f = project.fonts[slot];
    if (f && f.sourceRef && remap[f.sourceRef]) {
      project.fonts[slot] = { ...f, sourceRef: remap[f.sourceRef] };
    }
  }
  return { project, restoredSources: restored };
}

export function projectFileBlob(data: SerializedProject): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}
