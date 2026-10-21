import { describe, expect, it, vi } from 'vitest';
import {
  fetchMatrixClockFontBytes,
  formatMatrixClockFontSize,
  isMatrixClockFontPath,
  listMatrixClockFonts,
  MATRIX_CLOCK_TREES_URL,
  parseMatrixClockFontTree,
  type MatrixClockOnlineFont,
} from '../src/services/matrixClockFonts';

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number; remaining?: string } = {}) =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-ratelimit-remaining' ? init.remaining ?? null : null) },
    json: async () => body,
  }) as unknown as Response;

describe('Matrix Clock font paths', () => {
  it('accepts font files anywhere under fonts/, including subfolders', () => {
    expect(isMatrixClockFontPath('fonts/max7219.ttf')).toBe(true);
    expect(isMatrixClockFontPath('fonts/georgian-bold/Geo Bold.otf')).toBe(true);
    expect(isMatrixClockFontPath('fonts/a/b/c/font.WOFF2')).toBe(true);
    expect(isMatrixClockFontPath('fonts/pixel.bdf')).toBe(true);
  });

  it('rejects non-fonts, files outside fonts/ and unsafe paths', () => {
    expect(isMatrixClockFontPath('fonts/LICENSE.txt')).toBe(false);
    expect(isMatrixClockFontPath('fonts/README.md')).toBe(false);
    expect(isMatrixClockFontPath('packages/fonts/other.ttf')).toBe(false);
    expect(isMatrixClockFontPath('fonts/../secrets.ttf')).toBe(false);
    expect(isMatrixClockFontPath('fonts//double.ttf')).toBe(false);
    expect(isMatrixClockFontPath('fonts/font.ttf?raw=1')).toBe(false);
    expect(isMatrixClockFontPath(42)).toBe(false);
  });
});

describe('parseMatrixClockFontTree', () => {
  it('finds fonts in fonts/ and in subfolders, sorted by folder then name, with download URLs', () => {
    const fonts = parseMatrixClockFontTree({
      truncated: false,
      tree: [
        { type: 'tree', path: 'fonts' },
        { type: 'blob', path: 'fonts/georgian-bold/Geo Bold.ttf', size: 2048, sha: 'abc' },
        { type: 'blob', path: 'fonts/LICENSE.txt', size: 475 },
        { type: 'blob', path: 'fonts/max7219.ttf', size: 14652, sha: 'def' },
        { type: 'blob', path: 'fonts/max7219.ttf', size: 14652, sha: 'def' }, // duplicate
        { type: 'blob', path: 'docs/other.ttf', size: 10 },
        { type: 'tree', path: 'fonts/georgian-bold' },
      ],
    });
    expect(fonts.map((f) => f.path)).toEqual(['fonts/max7219.ttf', 'fonts/georgian-bold/Geo Bold.ttf']);
    expect(fonts[0]).toMatchObject({
      relativePath: 'max7219.ttf',
      fileName: 'max7219.ttf',
      folder: '',
      sizeBytes: 14652,
      sha: 'def',
      downloadUrl: 'https://raw.githubusercontent.com/sandro-defender/Esphome-Max7219-Matrix-Clock/main/fonts/max7219.ttf',
      siteUrl: 'https://sandro-defender.github.io/Esphome-Max7219-Matrix-Clock/fonts/max7219.ttf',
      pageUrl: 'https://github.com/sandro-defender/Esphome-Max7219-Matrix-Clock/blob/main/fonts/max7219.ttf',
    });
    expect(fonts[1]).toMatchObject({ relativePath: 'georgian-bold/Geo Bold.ttf', fileName: 'Geo Bold.ttf', folder: 'georgian-bold' });
    expect(fonts[1].downloadUrl).toContain('/fonts/georgian-bold/Geo%20Bold.ttf');
  });

  it('rejects a reply without a tree array', () => {
    expect(() => parseMatrixClockFontTree({})).toThrow(/unexpected reply/i);
    expect(() => parseMatrixClockFontTree(null)).toThrow(/unexpected reply/i);
  });
});

describe('listMatrixClockFonts', () => {
  it('lists via the recursive git trees API', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ truncated: false, tree: [{ type: 'blob', path: 'fonts/max7219.ttf', size: 14652 }] }),
    );
    const fonts = await listMatrixClockFonts({ fetchFn: fetchFn as never });
    expect(fonts.map((f) => f.fileName)).toEqual(['max7219.ttf']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(MATRIX_CLOCK_TREES_URL);
  });

  it('falls back to walking the contents API (including subfolders) when the tree is truncated', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url === MATRIX_CLOCK_TREES_URL) return jsonResponse({ truncated: true, tree: [] });
      if (url.includes('/contents/fonts?')) {
        return jsonResponse([
          { type: 'file', path: 'fonts/max7219.ttf', size: 14652, sha: 'a' },
          { type: 'file', path: 'fonts/LICENSE.txt', size: 475 },
          { type: 'dir', path: 'fonts/rounded' },
        ]);
      }
      if (url.includes('/contents/fonts/rounded?')) {
        return jsonResponse([{ type: 'file', path: 'fonts/rounded/Rounded.ttf', size: 9000, sha: 'b' }]);
      }
      throw new Error(`unexpected URL ${url}`);
    });
    const fonts = await listMatrixClockFonts({ fetchFn: fetchFn as never });
    expect(fonts.map((f) => f.path)).toEqual(['fonts/max7219.ttf', 'fonts/rounded/Rounded.ttf']);
    expect(fonts[1].folder).toBe('rounded');
  });

  it('explains the GitHub rate limit and the manual download fallback when listing fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 403, remaining: '0' }));
    await expect(listMatrixClockFonts({ fetchFn: fetchFn as never })).rejects.toThrow(/rate limit/i);
    await expect(listMatrixClockFonts({ fetchFn: fetchFn as never })).rejects.toThrow(/File → Open font/);
  });
});

describe('fetchMatrixClockFontBytes', () => {
  const font: MatrixClockOnlineFont = parseMatrixClockFontTree({
    tree: [{ type: 'blob', path: 'fonts/max7219.ttf', size: 3 }],
  })[0];

  it('downloads from the raw file base first', async () => {
    const bytes = new Uint8Array([0, 1, 0]).buffer;
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes });
    const got = await fetchMatrixClockFontBytes(font, fetchFn as never);
    expect(new Uint8Array(got)).toEqual(new Uint8Array([0, 1, 0]));
    expect(fetchFn).toHaveBeenCalledWith(font.downloadUrl);
  });

  it('falls back to the GitHub Pages site when the raw download fails', async () => {
    const bytes = new Uint8Array([7]).buffer;
    const fetchFn = vi.fn(async (url: string) =>
      url === font.downloadUrl
        ? ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response)
        : ({ ok: true, status: 200, arrayBuffer: async () => bytes } as Response),
    );
    const got = await fetchMatrixClockFontBytes(font, fetchFn as never);
    expect(new Uint8Array(got)).toEqual(new Uint8Array([7]));
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([font.downloadUrl, font.siteUrl]);
  });

  it('reports both hosts when the download fails everywhere', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(fetchMatrixClockFontBytes(font, fetchFn as never)).rejects.toThrow(/max7219\.ttf/);
  });
});

describe('formatMatrixClockFontSize', () => {
  it('formats bytes, KB and MB', () => {
    expect(formatMatrixClockFontSize(null)).toBe('');
    expect(formatMatrixClockFontSize(475)).toBe('475 B');
    expect(formatMatrixClockFontSize(14652)).toBe('14.3 KB');
    expect(formatMatrixClockFontSize(2_500_000)).toBe('2.4 MB');
  });
});
