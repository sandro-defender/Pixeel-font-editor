/**
 * WOFF2 decoding with the Google woff2 WebAssembly build that ships inside
 * fonteditor-core. Everything runs in the browser; the .wasm file is emitted by
 * Vite as a hashed asset (and honours the GitHub Pages base path). It is only
 * fetched the first time a .woff2 file is opened.
 */
import { woff2 } from 'fonteditor-core';
// The package's "exports" map hides this file from bare specifiers, so import it by path.
import wasmUrl from '../../node_modules/fonteditor-core/woff2/woff2.wasm?url';

let loading: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!loading) {
    loading = Promise.resolve(woff2.init(wasmUrl) as unknown as Promise<unknown>)
      .then(() => undefined)
      .catch((err) => {
        loading = null; // allow a retry (e.g. after a network blip)
        throw new Error(`The WOFF2 decoder could not be loaded (${err instanceof Error ? err.message : String(err)}). Check your connection and try again, or convert the font to .ttf first.`);
      });
  }
  return loading;
}

/** Decompress WOFF2 bytes to the original sfnt (TrueType/OpenType) bytes. */
export async function decodeWoff2(bytes: Uint8Array): Promise<Uint8Array> {
  await ensureReady();
  let out: Uint8Array;
  try {
    out = woff2.decode(bytes as unknown as ArrayBuffer);
  } catch {
    throw new Error('This WOFF2 file is corrupt or uses an unsupported feature, so it could not be decompressed.');
  }
  if (!out || out.length < 12) {
    throw new Error('This WOFF2 file is corrupt or uses an unsupported feature, so it could not be decompressed.');
  }
  return out;
}
