// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../src/services/matrixClockFonts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/matrixClockFonts')>()),
  listMatrixClockFonts: vi.fn(),
}));
vi.mock('../src/services/fileActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/fileActions')>()),
  importMatrixClockFont: vi.fn().mockResolvedValue(true),
}));

import { MatrixClockFontsDialog } from '../src/components/MatrixClockFontsDialog';
import { importMatrixClockFont } from '../src/services/fileActions';
import { listMatrixClockFonts, type MatrixClockOnlineFont } from '../src/services/matrixClockFonts';
import { useStore } from '../src/state/store';

const makeFont = (path: string, sizeBytes = 14652): MatrixClockOnlineFont => {
  const relativePath = path.replace(/^fonts\//, '');
  const slash = relativePath.lastIndexOf('/');
  return {
    path,
    relativePath,
    fileName: slash >= 0 ? relativePath.slice(slash + 1) : relativePath,
    folder: slash >= 0 ? relativePath.slice(0, slash) : '',
    sizeBytes,
    sha: 'x',
    downloadUrl: `https://raw.githubusercontent.com/test/${path}`,
    siteUrl: `https://example.github.io/${path}`,
    pageUrl: `https://github.com/test/${path}`,
  };
};

const FONTS = [makeFont('fonts/max7219.ttf'), makeFont('fonts/georgian-bold/GeoBold.ttf', 2048)];

const listMock = listMatrixClockFonts as unknown as ReturnType<typeof vi.fn>;
const importMock = importMatrixClockFont as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  listMock.mockReset();
  importMock.mockReset();
  importMock.mockResolvedValue(true);
  useStore.setState({ fonts: { A: null, B: null }, toasts: [], busy: null } as never);
  useStore.getState().openModal({ type: 'matrixClockFonts', slot: 'A' });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Matrix Clock fonts dialog', () => {
  it('lists fonts from fonts/ and from subfolders, grouped by folder', async () => {
    listMock.mockResolvedValue(FONTS);
    render(<MatrixClockFontsDialog slot="A" />);
    expect(await screen.findByText('max7219.ttf')).toBeTruthy();
    expect(screen.getByText('GeoBold.ttf')).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Matrix Clock fonts' });
    expect(within(list).getByText('fonts/')).toBeTruthy();
    expect(within(list).getByText('fonts/georgian-bold/')).toBeTruthy();
    expect(screen.getByText(/fonts\/georgian-bold\/GeoBold\.ttf · 2 KB/)).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it('loads the picked font into the selected workspace and closes', async () => {
    listMock.mockResolvedValue(FONTS);
    render(<MatrixClockFontsDialog slot="A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load GeoBold.ttf into Font A' }));
    await waitFor(() => expect(importMock).toHaveBeenCalledWith('A', FONTS[1]));
    await waitFor(() => expect(useStore.getState().modal.type).toBe('none'));
  });

  it('can target Font B instead', async () => {
    listMock.mockResolvedValue(FONTS);
    render(<MatrixClockFontsDialog slot="A" />);
    await screen.findByText('max7219.ttf');
    fireEvent.click(screen.getByRole('button', { name: 'Font B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load max7219.ttf into Font B' }));
    await waitFor(() => expect(importMock).toHaveBeenCalledWith('B', FONTS[0]));
  });

  it('stays open when the load is cancelled or fails', async () => {
    listMock.mockResolvedValue(FONTS);
    importMock.mockResolvedValue(false);
    render(<MatrixClockFontsDialog slot="A" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load max7219.ttf into Font A' }));
    await waitFor(() => expect(importMock).toHaveBeenCalled());
    expect(useStore.getState().modal.type).toBe('matrixClockFonts');
  });

  it('filters by file or folder name', async () => {
    listMock.mockResolvedValue(FONTS);
    render(<MatrixClockFontsDialog slot="A" />);
    await screen.findByText('max7219.ttf');
    fireEvent.change(screen.getByLabelText('Filter fonts'), { target: { value: 'georgian' } });
    expect(screen.queryByText('max7219.ttf')).toBeNull();
    expect(screen.getByText('GeoBold.ttf')).toBeTruthy();
  });

  it('shows the listing error and retries on demand', async () => {
    listMock.mockRejectedValueOnce(new Error('GitHub rate limit reached for anonymous listing.'));
    listMock.mockResolvedValue(FONTS);
    render(<MatrixClockFontsDialog slot="A" />);
    expect(await screen.findByText(/rate limit/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('max7219.ttf')).toBeTruthy();
    expect(listMock).toHaveBeenLastCalledWith({ forceRefresh: true });
  });
});
