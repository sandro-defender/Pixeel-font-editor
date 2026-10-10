import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph } from './helpers';
import { serializeProject, deserializeProject } from '../src/core/project';
import { saveRecovery, loadRecovery, clearRecovery } from '../src/core/idb';
import { hasSource, registerSource } from '../src/core/sourceRegistry';
import { parseProjectFile } from '../src/services/persistence';
import type { FontDoc } from '../src/core/types';

describe('project save / load', () => {
  it('round-trips a two-font project with metadata, grids and settings', () => {
    let a = newTestFont(8, 8, 'Alpha');
    a = drawGlyph(a, 65, (bm) => bm.rect(1, 1, 5, 5, 1, true)).doc;
    let b = newTestFont(16, 16, 'Beta');
    b = drawGlyph(b, 0x10d0, (bm) => bm.set(3, 3, 1)).doc;

    const payload = serializeProject({ A: a, B: b }, 'B', { theme: 'dark' });
    const json = JSON.stringify(payload);
    const { project } = deserializeProject(json);

    expect(project.format).toBe('pixeel-project');
    expect(project.active).toBe('B');
    expect(project.settings.theme).toBe('dark');
    expect(project.fonts.A?.meta.fontFamily).toBe('Alpha');
    expect(project.fonts.B?.meta.fontFamily).toBe('Beta');
    const ga = project.fonts.A!.glyphs.find((g) => g.unicode === 65);
    expect(ga?.pixel).toBeTruthy();
    expect(ga!.pixel!.width).toBe(8);
    const gb = project.fonts.B!.glyphs.find((g) => g.unicode === 0x10d0);
    expect(gb?.pixel).toBeTruthy();
  });

  it('rejects files that are not pixeel projects', () => {
    expect(() => deserializeProject('{"hello":1}')).toThrow(/pixeel/);
    expect(() => deserializeProject('not json')).toThrow(/JSON/);
  });

  it('keeps preserved source data out of the registry until the caller adopts it', () => {
    const doc = newTestFont();
    const ref = registerSource({ head: { unitsPerEm: 1000 }, glyf: [] } as never);
    const withRef: FontDoc = { ...doc, sourceRef: ref };
    const payload = serializeProject({ A: withRef, B: null }, 'A', { theme: 'light' });
    const { project, sources } = deserializeProject(JSON.stringify(payload));
    expect(Object.keys(sources)).toEqual([ref]);
    expect(project.fonts.A!.sourceRef).toBe(ref); // parsing does not rename anything
    expect(hasSource(ref)).toBe(true);
  });

  it('parseProjectFile registers the preserved source under a fresh ref', async () => {
    const doc = newTestFont();
    const ref = registerSource({ head: { unitsPerEm: 1000 }, glyf: [] } as never);
    const payload = serializeProject({ A: { ...doc, sourceRef: ref }, B: null }, 'A', { theme: 'light' });
    const file = new File([JSON.stringify(payload)], 'x.pixeel.json', { type: 'application/json' });
    const res = await parseProjectFile(file);
    const newRef = res.fonts.A!.sourceRef;
    expect(newRef).toBeTruthy();
    expect(newRef).not.toBe(ref);
    expect(hasSource(newRef)).toBe(true);
  });
});

describe('IndexedDB refresh recovery', () => {
  it('saves and restores a snapshot across a simulated refresh', async () => {
    let a = newTestFont(8, 8, 'RecoverMe');
    a = drawGlyph(a, 66, (bm) => bm.set(2, 2, 1)).doc;
    const payload = serializeProject({ A: a, B: null }, 'A', { theme: 'light' });
    await saveRecovery(payload);

    // simulate page refresh: nothing in memory, read from IDB
    const rec = await loadRecovery();
    expect(rec).toBeTruthy();
    expect(rec!.payload.project.fonts.A?.meta.fontFamily).toBe('RecoverMe');
    const { project } = deserializeProject(JSON.stringify(rec!.payload));
    expect(project.fonts.A?.glyphs.find((g) => g.unicode === 66)?.pixel).toBeTruthy();

    await clearRecovery();
    expect(await loadRecovery()).toBeNull();
  });
});
