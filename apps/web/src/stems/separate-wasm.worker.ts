// This entry intentionally never imports the JSEP/Asyncify runtime, including on CPU recovery.
// Vite's checked memory adapter bounds this pinned plain runtime to 256 MiB before it is bundled.
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { installSeparationWorker } from './separate';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };
installSeparationWorker(self as unknown as DedicatedWorkerGlobalScope, ort, 'wasm');
