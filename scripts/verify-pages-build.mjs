#!/usr/bin/env node
/**
 * Verify the production build works under a GitHub Pages repository subpath.
 *
 * 1. Builds with VITE_BASE_PATH=/test-repo/ (like a project page would).
 * 2. Checks dist/index.html references assets under that subpath.
 * 3. Serves dist/ under /test-repo/ with a static server and fetches the
 *    page + one JS asset to prove the subpath wiring end-to-end.
 *
 * Usage: node scripts/verify-pages-build.mjs
 */
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/test-repo/';

console.log('▶ Building with base', BASE);
execSync('npx vite build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: BASE },
});

const dist = path.join(root, 'dist');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');

const scriptRefs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
if (scriptRefs.length === 0) throw new Error('No asset references found in index.html');
for (const ref of scriptRefs) {
  if (ref.startsWith('data:') || ref.startsWith('http')) continue;
  if (!ref.startsWith(BASE)) {
    throw new Error(`Asset reference "${ref}" does not start with base "${BASE}"`);
  }
  const file = path.join(dist, ref.slice(BASE.length));
  if (!existsSync(file)) throw new Error(`Referenced asset missing on disk: ${ref}`);
}
console.log('✔ index.html asset paths use the repository subpath');

// Serve under the subpath and fetch
const mime = (p) => (p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(BASE)) {
    res.writeHead(404).end('not under base');
    return;
  }
  let rel = url.pathname.slice(BASE.length) || 'index.html';
  if (rel === '') rel = 'index.html';
  const file = path.join(dist, rel);
  readFile(file)
    .then((buf) => {
      res.writeHead(200, { 'Content-Type': mime(file) });
      res.end(buf);
    })
    .catch(() => res.writeHead(404).end('missing'));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const pageUrl = `http://127.0.0.1:${port}${BASE}`;
const page = await fetch(pageUrl);
if (page.status !== 200) throw new Error(`GET ${pageUrl} → ${page.status}`);
const pageText = await page.text();
if (!pageText.includes('<div id="root">')) throw new Error('Served page missing #root');
const jsRef = scriptRefs.find((r) => r.endsWith('.js'));
const jsUrl = `http://127.0.0.1:${port}${jsRef}`;
const js = await fetch(jsUrl);
if (js.status !== 200) throw new Error(`GET ${jsUrl} → ${js.status}`);
console.log(`✔ Served under ${BASE}: page and ${jsRef.split('/').pop()} fetch with 200`);
server.close();
console.log('✅ GitHub Pages subpath build verification PASSED');
