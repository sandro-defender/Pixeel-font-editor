import { describe, expect, it } from 'vitest';
import { resolveBase } from '../vite.config';
import { normalizeBase, joinBase, repoBaseFromRemoteUrl } from '../src/core/basepath';

describe('GitHub Pages base path handling', () => {
  it('derives the repository subpath for pages builds', () => {
    expect(resolveBase(undefined, true, 'Pixeel-font-editor')).toBe('/Pixeel-font-editor/');
    expect(resolveBase(undefined, true, 'my-site')).toBe('/my-site/');
  });

  it('respects an explicit VITE_BASE_PATH', () => {
    expect(resolveBase('/custom-base/', false)).toBe('/custom-base/');
    expect(resolveBase('custom-base', false)).toBe('/custom-base/');
    expect(resolveBase('/', true, 'repo')).toBe('/');
  });

  it('falls back to / for local development', () => {
    expect(resolveBase(undefined, false)).toBe('/');
    expect(resolveBase(undefined, true, null)).toBe('/');
  });

  it('normalizes and joins bases safely', () => {
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('a/b')).toBe('/a/b/');
    expect(joinBase('/repo/', 'assets/x.js')).toBe('/repo/assets/x.js');
    expect(joinBase('/', 'assets/x.js')).toBe('/assets/x.js');
  });

  it('derives repo base from common git remote URL forms', () => {
    expect(repoBaseFromRemoteUrl('https://github.com/user/Pixeel-font-editor.git')).toBe('/Pixeel-font-editor/');
    expect(repoBaseFromRemoteUrl('git@github.com:user/Pixeel-font-editor.git')).toBe('/Pixeel-font-editor/');
    expect(repoBaseFromRemoteUrl('https://github.com/user/repo')).toBe('/repo/');
    expect(repoBaseFromRemoteUrl('nonsense')).toBeNull();
  });
});
