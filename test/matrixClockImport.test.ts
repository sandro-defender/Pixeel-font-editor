/** End-to-end: a Matrix Clock listing entry downloads (stubbed fetch) and imports into a workspace. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importMatrixClockFont } from '../src/services/fileActions';
import { parseMatrixClockFontTree } from '../src/services/matrixClockFonts';
import { useStore } from '../src/state/store';

const latoBytes = () => {
  const b = readFileSync(resolve(__dirname, 'fixtures', 'Lato-Regular.ttf'));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const [font] = parseMatrixClockFontTree({
  tree: [{ type: 'blob', path: 'fonts/lato-clock/Lato-Regular.ttf', size: 1 }],
});

beforeEach(() => {
  useStore.setState({ fonts: { A: null, B: null }, fileNames: { A: null, B: null }, dirty: { A: false, B: false }, toasts: [], busy: null, modal: { type: 'none' } } as never);
});

afterEach(() => vi.unstubAllGlobals());

describe('importMatrixClockFont', () => {
  it('downloads the font from its raw URL and loads it into the chosen slot', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => latoBytes() });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await importMatrixClockFont('B', font);
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(font.downloadUrl);
    const state = useStore.getState();
    expect(state.fonts.B?.meta.fontFamily).toMatch(/Lato/);
    expect(state.fonts.A).toBeNull();
    expect(state.fileNames.B).toBe('Lato-Regular.ttf');
    expect(state.active).toBe('B');
    expect(state.busy).toBeNull();
    expect(state.toasts.some((t) => t.kind === 'success' && t.text.includes('from the Matrix Clock (fonts/lato-clock/Lato-Regular.ttf)'))).toBe(true);
  });

  it('leaves the workspace untouched and reports the error when the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    const ok = await importMatrixClockFont('A', font);
    expect(ok).toBe(false);
    const state = useStore.getState();
    expect(state.fonts.A).toBeNull();
    expect(state.busy).toBeNull();
    expect(state.toasts.some((t) => t.kind === 'error' && /Matrix Clock download failed/.test(t.text))).toBe(true);
  });
});
