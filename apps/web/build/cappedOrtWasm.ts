import type { Plugin } from 'vite';
import { STEMS_ORT_VERSION, STEMS_WASM_MAX_BYTES } from '../src/stems/wasmMemory';

// Exact published onnxruntime-web@1.30.0 plain bundle; dependency upgrades require a deliberate review.
const UPSTREAM_SHA256 = '11e64bd8ffe11bd1a2a2f0d6275fdfbbba7262f0b76b99b53d228a8a22ef3d90';
const MEMORY_CONSTRUCTOR = 'new WebAssembly.Memory({initial:256,maximum:65536,shared:!0})';
const GROWTH_CEILING = '4294901760';
const TARGET = '/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs';

/** Bound the existing runtime's memory, without changing the WASM binary or installed package. */
export async function capOrtWasmSource(source: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!source.includes(`ONNX Runtime Web v${STEMS_ORT_VERSION}`) || hash !== UPSTREAM_SHA256 ||
    source.split(MEMORY_CONSTRUCTOR).length !== 2 || source.split(GROWTH_CEILING).length !== 4) {
    throw new Error('The pinned ONNX plain runtime changed. Review its memory adapter before building ClassTempo.');
  }
  const pages = STEMS_WASM_MAX_BYTES / 65_536;
  const bounded = `(globalThis.__classTempoStemsWasmMemory=new WebAssembly.Memory({initial:256,maximum:${pages},shared:!0}))`;
  // Match the memory-growth ceiling too: failed growth must report bounded exhaustion rather than keep
  // requesting the upstream 4 GiB maximum. An imported memory with a smaller maximum is WASM-compatible.
  return source.replace(MEMORY_CONSTRUCTOR, bounded).replaceAll(GROWTH_CEILING, String(STEMS_WASM_MAX_BYTES));
}

/** Apply in both Vite's page graph (development) and separate worker graph (production). */
export function cappedOrtWasm(): Plugin {
  let adapted = false;
  return {
    name: 'classtempo-capped-ort-wasm',
    enforce: 'pre',
    async transform(source, id) {
      const [path = '', query = ''] = id.replaceAll('\\', '/').split('?');
      if (!path.endsWith(TARGET) || new URLSearchParams(query).has('raw') || new URLSearchParams(query).has('url')) return null;
      const code = await capOrtWasmSource(source);
      adapted = true;
      return { code, map: null };
    },
    generateBundle(_options, bundle) {
      // A changed package export must not silently bypass the adapter by resolving to a different bundle.
      const plainWorker = Object.values(bundle).some((output) => output.type === 'chunk' &&
        output.facadeModuleId?.replaceAll('\\', '/').endsWith('/separate-wasm.worker.ts'));
      if (plainWorker && !adapted) this.error('The plain stems worker was built without its checked ONNX memory cap.');
    },
  };
}
