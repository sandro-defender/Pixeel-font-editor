/**
 * Automatically discover and download fonts from the ESPHome MAX7219 Matrix
 * Clock project (sandro-defender/Esphome-Max7219-Matrix-Clock).
 *
 * Discovery uses the public GitHub "git trees" API with `recursive=1`, so
 * every font file under the repository's `fonts/` folder is found — the
 * bundled `fonts/max7219.ttf` as well as catalogue faces living in
 * `fonts/<slug>/<file>.ttf` subfolders. New fonts committed to that folder
 * (at any depth) therefore appear in Pixeel without a Pixeel update. When
 * the trees reply is unavailable or truncated, the contents API is walked
 * folder by folder instead.
 *
 * Downloads use `raw.githubusercontent.com/.../fonts/...` — the same
 * `fonts_base_url` the clock firmware itself is configured with — and fall
 * back to the project's GitHub Pages site. Both hosts serve
 * `Access-Control-Allow-Origin: *`, so the browser can fetch the bytes
 * directly; nothing is uploaded anywhere.
 */
import { FONT_FILE_RE } from '../core/fontFiles';

export const MATRIX_CLOCK_REPO = 'sandro-defender/Esphome-Max7219-Matrix-Clock';
export const MATRIX_CLOCK_BRANCH = 'main';
export const MATRIX_CLOCK_FONTS_FOLDER = 'fonts';
export const MATRIX_CLOCK_SITE_URL = 'https://sandro-defender.github.io/Esphome-Max7219-Matrix-Clock/';
export const MATRIX_CLOCK_FONTS_PAGE_URL = `https://github.com/${MATRIX_CLOCK_REPO}/tree/${MATRIX_CLOCK_BRANCH}/${MATRIX_CLOCK_FONTS_FOLDER}`;

const API_BASE = `https://api.github.com/repos/${MATRIX_CLOCK_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${MATRIX_CLOCK_REPO}/${MATRIX_CLOCK_BRANCH}`;
export const MATRIX_CLOCK_TREES_URL = `${API_BASE}/git/trees/${MATRIX_CLOCK_BRANCH}?recursive=1`;

const CACHE_TTL_MS = 5 * 60 * 1000;
/** The contents walk never follows folders deeper than this under fonts/. */
const MAX_WALK_DEPTH = 6;

export interface MatrixClockOnlineFont {
  /** Path in the repository, e.g. `fonts/max7219.ttf` or `fonts/georgian-bold/Geo.ttf`. */
  path: string;
  /** Path below `fonts/`, e.g. `max7219.ttf` or `georgian-bold/Geo.ttf`. */
  relativePath: string;
  /** File name only, e.g. `max7219.ttf`. */
  fileName: string;
  /** Subfolder below `fonts/` ('' when the file sits directly in `fonts/`). */
  folder: string;
  sizeBytes: number | null;
  sha: string | null;
  /** Primary download URL (the firmware's own `fonts_base_url` host). */
  downloadUrl: string;
  /** Fallback download URL on the project's GitHub Pages site. */
  siteUrl: string;
  /** Human-browsable page for the file on github.com. */
  pageUrl: string;
}

type FetchFn = typeof fetch;

function encodeRepoPath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/** Accept only safe, relative font paths inside fonts/ (no `..`, no empty or dot segments). */
export function isMatrixClockFontPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('?') || path.includes('#')) return false;
  if (!path.startsWith(`${MATRIX_CLOCK_FONTS_FOLDER}/`) || !FONT_FILE_RE.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function makeFont(path: string, sizeBytes: unknown, sha: unknown): MatrixClockOnlineFont {
  const relativePath = path.slice(MATRIX_CLOCK_FONTS_FOLDER.length + 1);
  const slash = relativePath.lastIndexOf('/');
  const encoded = encodeRepoPath(path);
  return {
    path,
    relativePath,
    fileName: slash >= 0 ? relativePath.slice(slash + 1) : relativePath,
    folder: slash >= 0 ? relativePath.slice(0, slash) : '',
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
    sha: typeof sha === 'string' && sha ? sha : null,
    downloadUrl: `${RAW_BASE}/${encoded}`,
    siteUrl: `${MATRIX_CLOCK_SITE_URL}${encoded}`,
    pageUrl: `https://github.com/${MATRIX_CLOCK_REPO}/blob/${MATRIX_CLOCK_BRANCH}/${encoded}`,
  };
}

function sortFonts(fonts: MatrixClockOnlineFont[]): MatrixClockOnlineFont[] {
  return fonts.sort((a, b) => a.folder.localeCompare(b.folder) || a.fileName.localeCompare(b.fileName) || a.path.localeCompare(b.path));
}

/** Turn a GitHub git-trees reply into the fonts under `fonts/` (any depth). */
export function parseMatrixClockFontTree(raw: unknown): MatrixClockOnlineFont[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { tree?: unknown }).tree)) {
    throw new Error('GitHub returned an unexpected reply while listing the Matrix Clock fonts.');
  }
  const seen = new Set<string>();
  const fonts: MatrixClockOnlineFont[] = [];
  for (const entry of (raw as { tree: unknown[] }).tree) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (item.type !== 'blob' || !isMatrixClockFontPath(item.path) || seen.has(item.path)) continue;
    seen.add(item.path);
    fonts.push(makeFont(item.path, item.size, item.sha));
  }
  return sortFonts(fonts);
}

function githubErrorMessage(response: Response): string {
  let remaining: string | null = null;
  try {
    remaining = response.headers?.get?.('x-ratelimit-remaining') ?? null;
  } catch {
    remaining = null;
  }
  if (response.status === 429 || (response.status === 403 && remaining === '0')) {
    return 'GitHub rate limit reached for anonymous listing (60 requests/hour). Wait a few minutes and press Refresh.';
  }
  if (response.status === 404) return `The ${MATRIX_CLOCK_FONTS_FOLDER}/ folder of ${MATRIX_CLOCK_REPO} was not found on branch “${MATRIX_CLOCK_BRANCH}” (404).`;
  return `GitHub request failed (${response.status}).`;
}

async function fetchJson(fetchFn: FetchFn, url: string): Promise<unknown> {
  const response = await fetchFn(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(githubErrorMessage(response));
  return response.json();
}

/** Fallback listing: walk the contents API folder by folder, so subfolders still work. */
async function listViaContents(fetchFn: FetchFn): Promise<MatrixClockOnlineFont[]> {
  const fonts: MatrixClockOnlineFont[] = [];
  const seen = new Set<string>();
  const walk = async (folderPath: string, depth: number): Promise<void> => {
    if (depth > MAX_WALK_DEPTH) return;
    const raw = await fetchJson(fetchFn, `${API_BASE}/contents/${encodeRepoPath(folderPath)}?ref=${encodeURIComponent(MATRIX_CLOCK_BRANCH)}`);
    if (!Array.isArray(raw)) throw new Error('GitHub returned an unexpected reply while listing the Matrix Clock fonts.');
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.path !== 'string' || item.path.includes('\\')) continue;
      if (item.type === 'dir') {
        await walk(item.path, depth + 1);
      } else if (item.type === 'file' && isMatrixClockFontPath(item.path) && !seen.has(item.path)) {
        seen.add(item.path);
        fonts.push(makeFont(item.path, item.size, item.sha));
      }
    }
  };
  await walk(MATRIX_CLOCK_FONTS_FOLDER, 0);
  return sortFonts(fonts);
}

let cache: { at: number; fonts: MatrixClockOnlineFont[] } | null = null;

/** Forget the cached font list (the dialog's Refresh uses forceRefresh instead). */
export function clearMatrixClockFontCache(): void {
  cache = null;
}

/**
 * List every font in the Matrix Clock repository's `fonts/` folder,
 * including subfolders. Results are cached for a few minutes so reopening
 * the picker does not burn through the anonymous GitHub rate limit.
 */
export async function listMatrixClockFonts(opts: { forceRefresh?: boolean; fetchFn?: FetchFn } = {}): Promise<MatrixClockOnlineFont[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const useCache = !opts.fetchFn; // an injected fetcher (tests) always runs live
  if (useCache && !opts.forceRefresh && cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.fonts;

  let fonts: MatrixClockOnlineFont[] | null = null;
  let treeError: unknown = null;
  try {
    const raw = await fetchJson(fetchFn, MATRIX_CLOCK_TREES_URL);
    if ((raw as { truncated?: unknown }).truncated === true) throw new Error('The repository tree was truncated by GitHub.');
    fonts = parseMatrixClockFontTree(raw);
  } catch (err) {
    treeError = err;
  }
  if (fonts === null) {
    try {
      fonts = await listViaContents(fetchFn);
    } catch {
      const message = treeError instanceof Error ? treeError.message : String(treeError);
      throw new Error(
        `Could not list the Matrix Clock fonts. ${message} Check your internet connection and press Refresh, ` +
          `or download a font from ${MATRIX_CLOCK_FONTS_PAGE_URL} and open it with File → Open font.`,
      );
    }
  }
  if (useCache) cache = { at: Date.now(), fonts };
  return fonts;
}

/**
 * Download one listed font. Tries the firmware's raw file base first, then
 * the project's GitHub Pages site.
 */
export async function fetchMatrixClockFontBytes(font: MatrixClockOnlineFont, fetchFn: FetchFn = fetch): Promise<ArrayBuffer> {
  const problems: string[] = [];
  for (const url of [font.downloadUrl, font.siteUrl]) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        problems.push(`${new URL(url).host} answered ${response.status}`);
        continue;
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength === 0) {
        problems.push(`${new URL(url).host} sent an empty file`);
        continue;
      }
      return buffer;
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  throw new Error(`Could not download “${font.fileName}” (${problems.join('; ')}). Check your internet connection and try again.`);
}

/** `14652` → `14.3 KB` (or `''` when the size is unknown). */
export function formatMatrixClockFontSize(sizeBytes: number | null): string {
  if (sizeBytes === null) return '';
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}
