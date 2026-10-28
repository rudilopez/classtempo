import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type Rollup } from 'vite';
import { cappedOrtWasm } from './build/cappedOrtWasm';
import { stemUnityPlayback } from './build/stemUnityPlayback';

const SW_FILE = 'sw.js';

export default defineConfig({
  // Relative base: the same build works at the domain root (Vercel) and under a sub-path (GitHub Pages /mixdeck/).
  base: './',
  plugins: [cappedOrtWasm(), stemUnityPlayback(), react(), mixdeckServiceWorker()],
  server: {
    // Not needed yet: only once SharedArrayBuffer ring buffers / multithreaded WASM land (see docs/ARCHITECTURE.md →
    // Performance & platform notes, Headers). Production hosts set nothing today.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: { format: 'es', plugins: () => [cappedOrtWasm()] },
  // Signalsmith Stretch (Dancer mode) builds its AudioWorklet module by stringifying its own source into a
  // Blob, so the package must reach the browser untranspiled: the dev-server optimizer would lower its class
  // fields to an `__publicField` helper that does not exist inside the AudioWorkletGlobalScope, and the
  // player would never become ready. `build.target` es2022 keeps them intact in production.
  optimizeDeps: { exclude: ['signalsmith-stretch', 'onnxruntime-web'] },
  build: { target: 'es2022' },
});

/**
 * Emits `sw.js` next to index.html, precaching normal app and guide assets (including worker chunks and public/)
 * under a cache name derived from their contents, so each deploy gets its own cache. Paths are relative to
 * the SW scope. Uses Rollup's `this.fs` and Web Crypto only, so the config needs no Node typings.
 */
function mixdeckServiceWorker(): Plugin {
  let publicDir = '';
  return {
    name: 'mixdeck-sw',
    apply: 'build',
    // Post: runs after Vite has emitted index.html and the worker chunks into the bundle.
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async generateBundle(_options, bundle) {
      const files = new Map<string, string | Uint8Array>();
      for (const [fileName, output] of Object.entries(bundle)) {
        files.set(fileName, output.type === 'chunk' ? output.code : output.source);
      }
      if (publicDir) {
        for (const path of await listFiles(this.fs, publicDir)) {
          if (!files.has(path)) files.set(path, await this.fs.readFile(`${publicDir}/${path}`));
        }
      }
      files.delete(SW_FILE);
      // The experimental lab and its large inference runtime are opt-in. Guide screenshots also load only
      // when requested, so reading help never adds image downloads to ordinary player startup.
      const precache = [...files.keys()].filter((path) =>
        !path.split('/').some((part) => part.startsWith('.')) &&
        !path.startsWith('guide/images/') && path !== 'apple-music-config.json' &&
        !/(?:AppleMusic|Spotify|StemsBenchmark|stems\.worker|separate(?:-wasm)?\.worker|ort-wasm|stems-runtime)/i.test(path),
      ).sort();
      // A screenshot-only edit still needs a new cache; otherwise its lazily cached old copy would persist.
      const versionFiles = [...precache, ...[...files.keys()].filter((path) => path.startsWith('guide/images/'))].sort();
      const version = await contentHash(versionFiles.flatMap((path) => [path, files.get(path) ?? '']).concat(swSource('', [])));
      this.emitFile({ type: 'asset', fileName: SW_FILE, source: swSource(version, precache) });
    },
  };
}

/** Recursively lists files under `root` as '/'-separated paths relative to it (empty if it doesn't exist). */
async function listFiles(fs: Rollup.RollupFsModule, root: string, dir = ''): Promise<string[]> {
  let entries: Rollup.RollupDirectoryEntry[];
  try {
    entries = await fs.readdir(dir ? `${root}/${dir}` : root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(fs, root, path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** First 12 hex chars of the SHA-256 over all parts (each NUL-terminated). */
async function contentHash(parts: (string | Uint8Array)[]): Promise<string> {
  const enc = new TextEncoder();
  const bytes = parts.flatMap((part) => [typeof part === 'string' ? enc.encode(part) : part, new Uint8Array(1)]);
  const all = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const b of bytes) {
    all.set(b, offset);
    offset += b.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The service worker. Install precaches the build (redirected responses are stored unflagged, so clean-URL
 * hosts that redirect index.html to ./ still open offline) and takes over at once (skipWaiting + claim), but the
 * page is never reloaded: a running set keeps its already-loaded code, and the new version shows up on the
 * next launch. Navigations are network-first (3 s timeout, then the cached page or index.html) so updates arrive
 * when online and the app still opens offline; everything else in scope is cache-first.
 */
function swSource(version: string, precache: string[]): string {
  return `// MixDeck service worker. Generated by the 'mixdeck-sw' plugin in apps/web/vite.config.ts; edit it there.
const CACHE = 'mixdeck-${version}';
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const NAV_TIMEOUT_MS = 3000;
// Directory of this script = the SW scope; precache paths are relative to it (works at / and at /mixdeck/).
const BASE = new URL('./', self.location.href).href;
const INDEX = new URL('index.html', BASE).href;
const MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE.map(async (path) => {
            const request = new Request(new URL(path, BASE), { cache: 'reload' });
            const response = await fetch(request);
            if (!response.ok) throw new Error('precache ' + path + ': HTTP ' + response.status);
            // Clean-URL hosts (Cloudflare Pages, Vercel cleanUrls, Netlify) redirect index.html to ./, and a response
            // flagged as redirected cannot answer a navigation, so store an unflagged copy of it.
            const { status, statusText, headers } = response;
            await cache.put(request, response.redirected ? new Response(await response.blob(), { status, statusText, headers }) : response);
          }),
        ),
      )
      // All or nothing, like cache.addAll: a half-filled cache must not outlive a failed install.
      .catch((err) => caches.delete(CACHE).then(() => Promise.reject(err)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const stale = keys.filter((key) => key.startsWith('mixdeck-') && key !== CACHE);
        // Keys are in creation order. Keep the newest previous cache for one more release: a page still running
        // the previous build (opened from cache, updated in the background mid-set) may lazy-load its own chunks.
        stale.pop();
        return Promise.all(stale.map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch blob:, data: or other non-HTTP schemes (decoded songs, worklet blobs), other origins or other apps on this origin.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;
  // Developer tokens expire and must never be served from a previous app cache.
  if (url.href.split('?')[0] === new URL('apple-music-config.json', BASE).href) return;
  // Media range requests go straight to the network; a cached full 200 would break them.
  if (request.headers.has('range')) return;
  event.respondWith(request.mode === 'navigate' ? networkFirstNavigate(request) : cacheFirst(request));
});

async function networkFirstNavigate(request) {
  const network = fetch(request).catch(() => null);
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  const fresh = await Promise.race([network, timeout]);
  if (fresh && (fresh.ok || fresh.type === 'opaqueredirect')) return fresh;
  // Static help pages must open their own cached HTML offline, rather than becoming the player shell.
  const cached = await caches.open(CACHE).then(async (cache) =>
    (await cache.match(request, { ...MATCH, ignoreSearch: true })) || cache.match(INDEX, MATCH),
  );
  // Nothing cached yet (first visit still installing): wait for the network however long it takes.
  return cached || (await network) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  // Screenshots are not precached. A new release fetches its current picture before reusing an older one;
  // old app chunks still use the previous cache so a running lesson can finish across a deployment.
  const guideImage = request.url.startsWith(new URL('guide/images/', BASE).href);
  const hit = (await cache.match(request, MATCH)) || (!guideImage && (await caches.match(request, MATCH)));
  if (hit) return hit;
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const previous = guideImage && (await caches.match(request, MATCH));
    if (previous) return previous;
    throw error;
  }
  // Only cache complete same-origin responses: no opaque, partial or error responses.
  if (response.status === 200 && response.type === 'basic') cache.put(request, response.clone()).catch(() => {});
  return response;
}
`;
}
