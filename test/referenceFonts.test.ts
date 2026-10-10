import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadReferenceFontCatalog } from '../src/services/referenceFonts';

afterEach(() => vi.unstubAllGlobals());

describe('reference-font catalog', () => {
  it('loads valid local TTF/OTF entries and ignores unsafe or duplicate paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        fonts: [
          { id: 'georgian', name: 'Georgian Sample', file: 'Geo.ttf' },
          { id: 'nested-font', name: 'Nested Sample', file: 'samples/Rounded.otf' },
          { id: 'traversal', name: 'Bad path', file: '../outside.ttf' },
          { id: 'url-font', name: 'Remote font', file: 'https://example.com/font.ttf' },
          { id: 'wrong-format', name: 'Bad format', file: 'font.woff2' },
          { id: 'georgian', name: 'Duplicate id', file: 'Other.ttf' },
          { id: 'bad id', name: 'Bad id', file: 'Bad.ttf' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const fonts = await loadReferenceFontCatalog();
    expect(fonts).toEqual([
      { id: 'georgian', name: 'Georgian Sample', file: 'Geo.ttf' },
      { id: 'nested-font', name: 'Nested Sample', file: 'samples/Rounded.otf' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/fonts/catalog.json', { cache: 'no-store' });
  });

  it('rejects a catalog without the expected fonts array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(loadReferenceFontCatalog()).rejects.toThrow(/fonts.*array/);
  });
});
