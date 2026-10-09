/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Resolve the Vite `base` for GitHub Pages project sites.
 *
 * Priority:
 *  1. VITE_BASE_PATH env var (explicit, e.g. "/Pixeel-font-editor/")
 *  2. When building with VITE_BUILD_PAGES=1 (npm run build:pages / deploy):
 *     derive the repository name from the git origin remote.
 *  3. "/" for plain local development and previews.
 */
export function resolveBase(envBase: string | undefined, pagesBuild: boolean, repoSlug?: string | null): string {
  if (envBase) {
    const b = envBase.trim();
    if (b === '/' || b === '') return '/';
    const withSlashes = (b.startsWith('/') ? b : '/' + b).replace(/\/+$/, '') + '/';
    return withSlashes;
  }
  if (pagesBuild && repoSlug) {
    return '/' + repoSlug.replace(/^\/+|\/+$/g, '') + '/';
  }
  return '/';
}

function repoSlugFromGit(): string | null {
  try {
    const url = execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const m = url.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = resolveBase(env.VITE_BASE_PATH, env.VITE_BUILD_PAGES === '1', repoSlugFromGit());
  return {
    base,
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
    preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 3000,
    },
    worker: { format: 'es' },
    test: {
      environment: 'node',
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
      testTimeout: 60000,
      hookTimeout: 60000,
    },
  };
});
