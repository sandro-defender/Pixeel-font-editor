// @vitest-environment jsdom
/**
 * The browser code path of the WOFF2 decoder (window is defined, so the wasm file
 * is fetched by URL instead of read from disk). fetch is served from disk here.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unwrapFont, sniffContainer } from '../src/core/woff';

describe('WOFF2 in the browser code path', () => {
  it('fetches the wasm decoder by URL and decompresses a font', async () => {
    const requested: string[] = [];
    const wasm = readFileSync(resolve(__dirname, '../node_modules/fonteditor-core/woff2/woff2.wasm'));
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(String(url));
      if (!String(url).endsWith('.wasm')) return new Response('not found', { status: 404 });
      return new Response(wasm, { status: 200, headers: { 'Content-Type': 'application/wasm' } });
    });
    const b = readFileSync(resolve(__dirname, 'fixtures/Lato-Regular.woff2'));
    const { buffer, container } = await unwrapFont(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    expect(container).toBe('woff2');
    expect(sniffContainer(buffer)).toBe('sfnt');
    expect(requested.some((u) => u.endsWith('.wasm'))).toBe(true);
    vi.unstubAllGlobals();
  });
});
