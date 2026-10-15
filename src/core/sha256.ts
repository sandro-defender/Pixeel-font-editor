/** Tiny cross-environment SHA-256 helper (browser + Node). */

/** Compute SHA-256 hex digest of a buffer. */
export async function sha256Hex(buf: ArrayBuffer | Uint8Array): Promise<string> {
  // Build a fresh ArrayBuffer that owns its bytes (no offsets, no SharedArrayBuffer).
  const ab: ArrayBuffer = buf instanceof Uint8Array
    ? (buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    : buf;
  const src = new Uint8Array(ab);
  // Browser / Node 18+ (Web Crypto)
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.subtle?.digest === 'function') {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', src);
    return hexFrom(new Uint8Array(digest));
  }
  // Node fallback (older Node without WebCrypto) — only reachable in Node tests/builds.
  if (typeof process !== 'undefined' && (process as any).versions?.node) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.createHash('sha256').update(Buffer.from(src)).digest('hex');
  }
  throw new Error('SHA-256 is not available in this environment (crypto.subtle missing).');
}

function hexFrom(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
