import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { installSeparationWorker } from './separate';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };
installSeparationWorker(self as unknown as DedicatedWorkerGlobalScope, ort, 'webgpu-jsep');
