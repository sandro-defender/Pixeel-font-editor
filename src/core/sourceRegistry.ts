/**
 * Registry holding parsed source-font objects (too large to snapshot into
 * undo history on every edit). Fonts reference entries via `sourceRef`.
 */
import type { TtfLike } from './fontCodec';

const registry = new Map<string, TtfLike>();

export function registerSource(ttf: TtfLike): string {
  const ref = 'src_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  registry.set(ref, ttf);
  return ref;
}

export function getSource(ref: string | null): TtfLike | null {
  if (!ref) return null;
  return registry.get(ref) ?? null;
}

export function unregisterSource(ref: string | null): void {
  if (ref) registry.delete(ref);
}

export function hasSource(ref: string | null): boolean {
  return !!ref && registry.has(ref);
}
