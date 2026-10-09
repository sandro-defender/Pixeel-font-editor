import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { newTestFont, drawGlyph } from './helpers';
import { serializeProject, deserializeProject } from '../src/core/project';
import { saveRecovery, loadRecovery, clearRecovery } from '../src/core/idb';
import { registerSource } from '../src/core/sourceRegistry';
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

  it('restores preserved source data through a project round-trip', () => {
    const doc = newTestFont();
    const ref = registerSource({ head: { unitsPerEm: 1000 }, glyf: [] } as never);
    const withRef: FontDoc = { ...doc, sourceRef: ref };
    const payload = serializeProject({ A: withRef, B: null }, 'A', { theme: 'light' });
    const { project, restoredSources } = deserializeProject(JSON.stringify(payload));
    expect(restoredSources).toBe(1);
    expect(project.fonts.A!.sourceRef).toBeTruthy();
    expect(project.fonts.A!.sourceRef).not.toBe(ref); // re-registered under a new ref
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
