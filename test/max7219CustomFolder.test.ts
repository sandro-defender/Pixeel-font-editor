// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCustomFolderFiles, writeCustomFolder } from '../src/services/max7219CustomFolder';
import { buildMax7219Package, defaultMax7219Settings } from '../src/services/max7219Export';
import { newTestFont } from './helpers';
import { downloadBlob } from '../src/services/persistence';

vi.mock('../src/services/persistence', () => ({ downloadBlob: vi.fn() }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

async function fixture() {
  const doc = newTestFont(8, 8, 'CustomClock');
  return buildMax7219Package(doc, {
    ...defaultMax7219Settings(doc), label: "Maker's Clock", glyphs: "0123456789:'",
    licenseName: 'MIT', licenseText: 'MIT License',
  });
}

describe('custom folder export', () => {
  it('builds exactly the contract files with escaped YAML and metadata', async () => {
    const pkg = await fixture();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:34:56.789Z'));
    const files = buildCustomFolderFiles(pkg);
    expect(Object.keys(files)).toEqual(['font.ttf', 'LICENSE.txt', 'font-info.json', 'custom_font.yaml']);
    expect(files['font.ttf']).toBe(pkg.ttf);
    expect(files['LICENSE.txt']).toBe('MIT License');
    expect(files['font-info.json'].endsWith('\n')).toBe(true);
    const info = JSON.parse(files['font-info.json']);
    expect(info).toMatchObject({
      label: "Maker's Clock", glyphs: "0123456789:'", contractVersion: 1,
      slug: pkg.settings.slug, sourceTtfName: pkg.settings.ttfFileName,
      ttfSha256: pkg.ttfSha256, installedAt: '2026-10-20T12:34:56Z',
      fontId: 'font_custom_face', macro: 'MAX7219_CUSTOM_FACE', exportReportStatus: 'FAIL',
      measuredTestString: '88:88:88', measuredTestStringWidthPx: pkg.validation.measuredTestStringWidthPx,
      tallestDigitPx: pkg.validation.tallestDigitPx,
    });
    for (const text of ['font_custom_face', '-DMAX7219_CUSTOM_FACE', 'type: local', 'path: font.ttf',
      "initial_option: 'Maker''s Clock'", "- '0123456789:'''", 'id: !extend clock_font']) {
      expect(files['custom_font.yaml']).toContain(text);
    }
    expect(buildCustomFolderFiles(pkg)).toEqual(files);
    pkg.validation.ok = true;
    expect(JSON.parse(buildCustomFolderFiles(pkg)['font-info.json']).exportReportStatus).toBe('PASS');
  });

  it('picks a directory and overwrites exactly four files', async () => {
    const files = buildCustomFolderFiles(await fixture());
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const getFileHandle = vi.fn().mockResolvedValue({ createWritable: async () => ({ write, close, abort: vi.fn() }) });
    const picker = vi.fn().mockResolvedValue({ getFileHandle });
    vi.stubGlobal('showDirectoryPicker', picker);
    expect(await writeCustomFolder(files)).toBe('written');
    expect(picker).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(getFileHandle.mock.calls).toEqual(Object.keys(files).map(name => [name, { create: true }]));
    expect(write).toHaveBeenCalledTimes(4);
    expect(close).toHaveBeenCalledTimes(4);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('downloads individually when the API is missing', async () => {
    const files = buildCustomFolderFiles(await fixture());
    expect(await writeCustomFolder(files)).toBe('downloaded');
    expect(vi.mocked(downloadBlob).mock.calls.map(call => call[1])).toEqual(Object.keys(files));
  });

  it('swallows picker cancellation, but surfaces other errors', async () => {
    const files = buildCustomFolderFiles(await fixture());
    const picker = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    vi.stubGlobal('showDirectoryPicker', picker);
    expect(await writeCustomFolder(files)).toBe('cancelled');
    expect(downloadBlob).not.toHaveBeenCalled();
    picker.mockRejectedValue(new Error('Permission denied'));
    await expect(writeCustomFolder(files)).rejects.toThrow('Permission denied');
  });
});
