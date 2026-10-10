#!/usr/bin/env node
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fontRoot = path.join(root, 'public', 'fonts');
const output = path.join(fontRoot, 'catalog.json');

async function listFontFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFontFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile() && /\.(ttf|otf)$/i.test(entry.name)) files.push(relative);
  }
  return files;
}

function slug(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'font';
  return /^[a-z0-9]/.test(normalized) ? normalized : `font-${normalized}`.slice(0, 64);
}

function displayName(file) {
  return path.posix.basename(file).replace(/\.(ttf|otf)$/i, '').replace(/[_-]+/g, ' ').trim();
}

const files = (await listFontFiles(fontRoot)).sort((a, b) => a.localeCompare(b));
const usedIds = new Set();
const fonts = files.map((file) => {
  const baseId = slug(file.replace(/\.(ttf|otf)$/i, '').replaceAll('/', '-'));
  let id = baseId;
  let suffix = 2;
  while (usedIds.has(id)) id = `${baseId.slice(0, 59)}-${suffix++}`;
  usedIds.add(id);
  return { id, name: displayName(file), file };
});

await writeFile(output, `${JSON.stringify({ fonts }, null, 2)}\n`, 'utf8');
console.log(`Reference font catalog: ${fonts.length} font(s) indexed.`);
