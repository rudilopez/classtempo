import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import { chunkOffsets, overlapWindow, StreamingOverlapAdd } from './chunks';
import {
  CHUNK_SAMPLES, MODEL_CACHE, OVERLAP_SAMPLES, SAMPLE_RATE, STEM_MODEL, STRIDE_SAMPLES,
  type BenchmarkInput, type BenchmarkMessage, type BenchmarkReport,
} from './model';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const send = (message: BenchmarkMessage): void => scope.postMessage(message);
const progress = (stage: string, fraction: number | null = null): void => send({ type: 'progress', stage, fraction });

// One inference worker, one runtime thread: also works on Pages without COOP/COEP headers.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };

async function loadModel(): Promise<{ bytes: Uint8Array; fromCache: boolean; cached: boolean }> {
  let cache: Cache | null = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { /* Private browsing may disable storage. */ }
  const saved = await cache?.match(STEM_MODEL.url).catch(() => undefined);
  let response = saved;
  const fromCache = !!saved;
  if (!response) response = await fetch(STEM_MODEL.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);

  progress(fromCache ? 'Reading cached model…' : 'Downloading 166 MB model…', 0);
  const bytes = new Uint8Array(STEM_MODEL.bytes);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot stream the model download');
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes.length) {
      await reader.cancel();
      throw new Error('Model size does not match the pinned artifact');
    }
    bytes.set(value, offset);
    offset += value.length;
    progress(fromCache ? 'Reading cached model…' : 'Downloading model…', offset / bytes.length);
  }
  if (offset !== bytes.length) throw new Error('Model download is incomplete; retry on a stable connection');
  progress('Verifying model SHA-256…');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== STEM_MODEL.sha256) {
    if (fromCache) await cache?.delete(STEM_MODEL.url);
    throw new Error('Model integrity check failed; no inference was run');
  }
  let cached = fromCache;
  if (cache && !fromCache) {
    progress('Saving model for the next benchmark…');
    try {
      await cache.put(STEM_MODEL.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
      cached = true;
    } catch { /* Running without a persistent model is allowed for the spike. */ }
  }
  return { bytes, fromCache, cached };
}

function heapBytes(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize : null;
}

async function benchmark(input: BenchmarkInput): Promise<void> {
  const start = performance.now();
  const total = input.channels[0].length;
  if (total < 1 || total > 240 * SAMPLE_RATE || input.channels[1].length !== total) {
    throw new Error('Choose a 30-second or 4-minute stereo clip');
  }
  let peakHeap = heapBytes();
  const sampleHeap = (): void => {
    const value = heapBytes();
    if (value !== null) peakHeap = Math.max(value, peakHeap ?? 0);
  };
  const sampleTimer = setInterval(sampleHeap, 250);
  let session: ort.InferenceSession | null = null;
  try {
    const model = await loadModel();
    sampleHeap();
    const downloadMs = performance.now() - start;
    const initializationStart = performance.now();
    let provider: 'webgpu' | 'wasm' = 'wasm';
    let fallbackReason: string | null = null;
    let gpuSubmissionsObserved = 0;
    if (input.provider === 'auto' && 'gpu' in navigator) {
      try {
        progress('Preparing WebGPU session…');
        session = await ort.InferenceSession.create(model.bytes, {
          executionProviders: ['webgpu', 'wasm'],
          // The export contains a large float64 iSTFT subgraph. ORT's constant folding can exceed
          // the browser's WASM address space during initialization; keep it at runtime in this spike.
          graphOptimizationLevel: 'disabled',
        });
        provider = 'webgpu';
        // Observe submissions on this worker's runtime-owned device. Native ORT does not expose JSEP's
        // profiling callback. If the browser prevents observation, report GPU execution as unverified.
        try {
          const device = await ort.env.webgpu.device as unknown as { queue: { submit: (buffers: unknown) => void } };
          const original = device.queue.submit.bind(device.queue);
          device.queue.submit = (buffers: unknown): void => { gpuSubmissionsObserved++; original(buffers); };
        } catch { /* Successful session creation alone is not GPU execution evidence. */ }
      } catch (error) {
        fallbackReason = `WebGPU session failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    } else if (input.provider === 'auto') {
      fallbackReason = 'WebGPU is unavailable in this browser worker';
    }
    if (!session) {
      progress('Preparing WASM CPU session (may take a while)…');
      try {
        session = await ort.InferenceSession.create(model.bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'disabled',
        });
      } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        throw new Error(`${fallbackReason ? `${fallbackReason}. ` : ''}WASM session failed: ${failure}`);
      }
    }
    if (!session.inputNames.includes('mix') || !session.outputNames.includes('stems')) {
      throw new Error('Model input/output contract differs from the pinned model card');
    }
    // Release our model copy after ORT has created the session. The runtime owns its own memory.
    model.bytes = new Uint8Array(0);
    const initializationMs = performance.now() - initializationStart;
    const offsets = chunkOffsets(total, CHUNK_SAMPLES, STRIDE_SAMPLES);
    const window = overlapWindow(CHUNK_SAMPLES, OVERLAP_SAMPLES);
    const previewSamples = Math.min(total, 5 * SAMPLE_RATE);
    const overlap = new StreamingOverlapAdd(8, CHUNK_SAMPLES, STRIDE_SAMPLES, previewSamples);
    const separationStart = performance.now();
    for (let index = 0; index < offsets.length; index++) {
      const offset = offsets[index]!;
      progress(`Separating chunk ${index + 1} of ${offsets.length} (${provider.toUpperCase()})…`, index / offsets.length);
      const valid = Math.min(CHUNK_SAMPLES, total - offset);
      const pcm = new Float32Array(2 * CHUNK_SAMPLES);
      pcm.set(input.channels[0].subarray(offset, offset + valid));
      pcm.set(input.channels[1].subarray(offset, offset + valid), CHUNK_SAMPLES);
      const tensor = new ort.Tensor('float32', pcm, [1, 2, CHUNK_SAMPLES]);
      let outputs: ort.InferenceSession.ReturnType | null = null;
      try {
        outputs = await session.run({ mix: tensor });
        const stems = outputs.stems;
        if (!stems || stems.type !== 'float32' || stems.dims.join(',') !== `1,4,2,${CHUNK_SAMPLES}`) {
          throw new Error('Model returned an unexpected stem shape or type');
        }
        overlap.add(stems.data as Float32Array, valid, index === offsets.length - 1, window);
      } finally {
        tensor.dispose();
        if (outputs) for (const output of Object.values(outputs)) output.dispose();
      }
      sampleHeap();
    }
    const separationMs = performance.now() - separationStart;
    const report: BenchmarkReport = {
      modelRevision: STEM_MODEL.revision,
      modelSha256: STEM_MODEL.sha256,
      modelBytes: STEM_MODEL.bytes,
      modelFromCache: model.fromCache,
      modelCached: model.cached,
      runtimeVersion: ort.env.versions.web ?? '1.30.0',
      clipSeconds: total / SAMPLE_RATE,
      chunks: offsets.length,
      provider,
      gpuSubmissionsObserved,
      fallbackReason,
      downloadMs,
      initializationMs,
      separationMs,
      workerTotalMs: performance.now() - start,
      stemRms: [0, 1, 2, 3].map((stem) => Math.hypot(overlap.rms[stem * 2]!, overlap.rms[stem * 2 + 1]!) / Math.SQRT2),
      previewSamples,
      peakWorkerJsHeapBytes: peakHeap,
      ownedPcmBytes: (2 * total + 2 * CHUNK_SAMPLES + 8 * CHUNK_SAMPLES + 8 * CHUNK_SAMPLES + 2 * CHUNK_SAMPLES + 8 * previewSamples) * 4,
    };
    scope.postMessage({ type: 'complete', report, previews: overlap.preview } satisfies BenchmarkMessage,
      overlap.preview.map((array) => array.buffer as ArrayBuffer));
  } finally {
    clearInterval(sampleTimer);
    if (session) await session.release();
  }
}

scope.onmessage = (event: MessageEvent<BenchmarkInput>): void => {
  // Cancellation terminates this worker, including download, graph compilation, or a synchronous WASM call.
  void benchmark(event.data).catch((error: unknown) => {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  });
};
