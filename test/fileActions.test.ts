import { describe, expect, it } from 'vitest';
import { newTestFont } from './helpers';
import { releaseSourcesNotIn } from '../src/services/fileActions';
import { hasSource, registerSource } from '../src/core/sourceRegistry';

describe('source cleanup after a font is replaced', () => {
  it('drops the source table of a replaced font and keeps the ones still in use', () => {
    const oldRef = registerSource({ head: { unitsPerEm: 1000 }, glyf: [] } as never);
    const keptRef = registerSource({ head: { unitsPerEm: 1000 }, glyf: [] } as never);
    const before = [{ ...newTestFont(), sourceRef: oldRef }, { ...newTestFont(), sourceRef: keptRef }];
    const after = [null, before[1]];
    releaseSourcesNotIn(before, after);
    expect(hasSource(oldRef)).toBe(false);
    expect(hasSource(keptRef)).toBe(true);
  });
});
