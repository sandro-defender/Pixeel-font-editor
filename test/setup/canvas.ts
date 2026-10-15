/**
 * Real HTML Canvas backend for jsdom-based tests.
 *
 * jsdom implements the DOM but no rasterizer: its `HTMLCanvasElement.getContext()`
 * logs `Not implemented: HTMLCanvasElement's getContext() method…` and returns
 * `null`. This setup file patches the jsdom prototype so that every canvas
 * element created inside a test gets a *real* 2D rendering context backed by
 * `@napi-rs/canvas` (a Skia build shipped as a prebuilt binary, so no system
 * libraries are needed locally or in CI).
 *
 * Design notes:
 *  - Only activates inside a jsdom environment; node-environment test files
 *    (the pure-logic suites) are unaffected.
 *  - Each `HTMLCanvasElement` owns one backing record (WeakMap). `width` /
 *    `height` assignments are forwarded to the record, so resizing a canvas —
 *    including the `canvas.width = canvas.width` clear idiom — recreates the
 *    surface *and* its drawing state, which is exactly what the HTML standard
 *    prescribes (resize resets the bitmap and the context state). Recreating
 *    also works around @napi-rs/canvas keeping a stale clipping surface alive
 *    on the old context object after `canvas.width = …`.
 *  - Rendered pixels are real: `getImageData`, `putImageData`, `drawImage`,
 *    `measureText`, `fillText`, paths, shadows, transforms all behave like a
 *    browser within the limits of Skia's headless font stack.
 *  - `Path2D` is missing from jsdom; the napi implementation is exposed as a
 *    global because application code (glyph previews) constructs it.
 *  - The bundled OFL `Lato-Regular.ttf` fixture is registered under a
 *    test-only family name so text tests do not depend on the fonts installed
 *    on the machine running the suite.
 */
import { createCanvas, GlobalFonts, Path2D, type Canvas as NapiCanvas } from '@napi-rs/canvas';
import { resolve } from 'node:path';

/** Font family registered from the bundled Lato fixture (OFL-licensed). */
export const TEST_FONT_FAMILY = 'Pixeel Test Lato';

type NapiContext2D = ReturnType<NapiCanvas['getContext']>;

interface Backing {
  /** The real Skia surface (clamped to ≥1×1; Skia rejects empty surfaces). */
  surface: NapiCanvas;
  /** The raw context owned by `surface`; recreated together with it. */
  realCtx: NapiContext2D;
  /** Logical size as reported by the element's IDL attributes. */
  width: number;
  height: number;
  /** Cached wrapped context — repeated getContext('2d') must return the same object. */
  context: CanvasRenderingContext2D | null;
}

/** One backing record per DOM canvas element. */
const ELEMENT_BACKING = new WeakMap<HTMLCanvasElement, Backing>();

function clampSurfaceSize(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

function newSurface(width: number, height: number): { surface: NapiCanvas; realCtx: NapiContext2D } {
  const surface = createCanvas(clampSurfaceSize(width), clampSurfaceSize(height));
  return { surface, realCtx: surface.getContext('2d') as NapiContext2D };
}

/** jsdom's prototype accessors for the width/height IDL attributes. */
function sizeDescriptors(): Record<'width' | 'height', PropertyDescriptor | undefined> {
  return {
    width: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width'),
    height: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'height'),
  };
}

function elementSize(el: HTMLCanvasElement): { width: number; height: number } {
  const d = sizeDescriptors();
  return {
    width: d.width?.get ? Number(d.width.get.call(el)) : el.width,
    height: d.height?.get ? Number(d.height.get.call(el)) : el.height,
  };
}

/**
 * Apply a logical size to the backing record by recreating the surface and the
 * raw context. This clears the bitmap and resets the drawing state — even for
 * an unchanged value — which is what the HTML standard requires, and it also
 * avoids the stale-clipped context @napi-rs/canvas keeps after `width = …`.
 * Cached wrappers resolve `realCtx` lazily, so previously handed-out contexts
 * keep working (also per spec: the context object survives a resize).
 */
function applyLogicalSize(b: Backing, width: number, height: number): void {
  b.width = width;
  b.height = height;
  const fresh = newSurface(width, height);
  b.surface = fresh.surface;
  b.realCtx = fresh.realCtx;
}

/**
 * Reconcile the backing record with the element's current IDL size. Catches
 * resizes performed through `setAttribute` (which bypasses property setters).
 */
function syncSize(el: HTMLCanvasElement, b: Backing): void {
  const { width, height } = elementSize(el);
  if (b.width !== width || b.height !== height) applyLogicalSize(b, width, height);
}

/**
 * Shadow the element's width/height with own accessors that keep the jsdom
 * attribute and the backing record in lockstep.
 */
function installSizeForwarding(el: HTMLCanvasElement): void {
  const d = sizeDescriptors();
  for (const prop of ['width', 'height'] as const) {
    const original = d[prop];
    if (!original?.get || !original.set) continue;
    Object.defineProperty(el, prop, {
      configurable: true,
      enumerable: true,
      get(this: HTMLCanvasElement): number {
        return original.get!.call(this);
      },
      set(this: HTMLCanvasElement, value: number) {
        original.set!.call(this, value);
        const b = ELEMENT_BACKING.get(this);
        if (!b) return;
        const { width, height } = elementSize(this);
        applyLogicalSize(b, width, height);
      },
    });
  }
}

/** Lazily create (once per element) the Skia surface sized after the element. */
function backingFor(el: HTMLCanvasElement): Backing {
  let b = ELEMENT_BACKING.get(el);
  if (!b) {
    const { width, height } = elementSize(el);
    const { surface, realCtx } = newSurface(width, height);
    b = { surface, realCtx, width, height, context: null };
    ELEMENT_BACKING.set(el, b);
    installSizeForwarding(el);
  }
  return b;
}

/**
 * A DOM canvas element used as a draw source (drawImage/createPattern) is
 * replaced by its backing surface — Skia cannot consume foreign DOM objects.
 */
function unwrapDrawSource(source: unknown): unknown {
  if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
    return backingFor(source).surface;
  }
  return source;
}

/**
 * Wrap the backing record so it behaves like the DOM's
 * CanvasRenderingContext2D:
 *  - `ctx.canvas` is the originating element (app code reads guides from it);
 *  - every call resolves the *current* raw context, so a resize (which
 *    recreates surface + context, like a browser reset) never strands a
 *    previously obtained wrapper on a dead surface;
 *  - drawing calls reconcile the surface size first;
 *  - drawImage/createPattern accept DOM canvas elements.
 * Everything else — state stack, transforms, text, pixels — is the real thing.
 */
function wrapContext(el: HTMLCanvasElement, b: Backing): CanvasRenderingContext2D {
  const real = (): Record<PropertyKey, unknown> => b.realCtx as unknown as Record<PropertyKey, unknown>;
  return new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      if (prop === 'canvas') return el;
      const value = Reflect.get(real(), prop);
      if (prop === 'drawImage') {
        return (source: unknown, ...args: number[]) => {
          syncSize(el, b);
          const fn = Reflect.get(real(), 'drawImage') as (s: unknown, ...a: number[]) => unknown;
          return fn.call(real(), unwrapDrawSource(source), ...args);
        };
      }
      if (prop === 'createPattern') {
        return (source: unknown, repetition: string) => {
          syncSize(el, b);
          const fn = Reflect.get(real(), 'createPattern') as (s: unknown, r: string) => unknown;
          return fn.call(real(), unwrapDrawSource(source), repetition);
        };
      }
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          syncSize(el, b);
          const fn = Reflect.get(real(), prop) as (...a: unknown[]) => unknown;
          return fn.apply(real(), args);
        };
      }
      return value;
    },
    set(_target, prop, value) {
      return Reflect.set(real(), prop, value);
    },
    has(_target, prop) {
      return prop === 'canvas' || prop in real();
    },
  }) as unknown as CanvasRenderingContext2D;
}

function installRealCanvasBackend(): void {
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    contextId: string,
  ): RenderingContext | null {
    // Only 2D rendering is supported by this backend. Returning null for the
    // other context types (webgl, webgl2, bitmaprenderer, …) matches the
    // behavior of browsers where those APIs are unavailable — silently,
    // without jsdom's "Not implemented" console noise.
    if (contextId !== '2d') return null;
    const b = backingFor(this);
    syncSize(this, b);
    if (!b.context) b.context = wrapContext(this, b);
    return b.context;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // jsdom ships no Path2D; glyph previews build vector outlines with it.
  const g = globalThis as Record<string, unknown>;
  if (typeof g.Path2D === 'undefined') g.Path2D = Path2D;

  // Deterministic text measurement/rendering independent of the host's fonts.
  try {
    GlobalFonts.registerFromPath(resolve(__dirname, '../fixtures/Lato-Regular.ttf'), TEST_FONT_FAMILY);
  } catch {
    // Fixture moved or unreadable: canvas still works, only text tests that
    // depend on TEST_FONT_FAMILY will fail loudly.
  }
}

// Only patch inside a DOM-like (jsdom) environment. Pure Node test files never
// touch the DOM and stay on their fast path.
if (typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined') {
  installRealCanvasBackend();
}
