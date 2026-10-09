/**
 * GitHub Pages base-path helpers.
 *
 * The app can be served from any sub-path (e.g. /Pixeel-font-editor/).
 * Vite rewrites asset URLs at build time using `base`; runtime code should
 * use `import.meta.env.BASE_URL` (re-exported here for testability).
 */

/** Normalize an arbitrary user/env-supplied base into Vite's "/x/" form. */
export function normalizeBase(input: string | undefined | null): string {
  if (!input) return '/';
  const trimmed = input.trim();
  if (trimmed === '' || trimmed === '/') return '/';
  return '/' + trimmed.replace(/^\/+/, '').replace(/\/+$/, '') + '/';
}

/** Join a base path and a relative resource path. */
export function joinBase(base: string, rel: string): string {
  const b = normalizeBase(base);
  if (rel.startsWith('/')) return rel;
  return b + rel;
}

/** Derive the repository base from a GitHub Pages-style origin URL. */
export function repoBaseFromRemoteUrl(url: string): string | null {
  const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return null;
  return '/' + m[2] + '/';
}
