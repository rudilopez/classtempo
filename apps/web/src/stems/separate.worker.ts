import * as ort from 'onnxruntime-web';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import {
  MAX_SEPARATION_SECONDS, SEPARATION_MODEL_BYTES, SEPARATION_MODEL_CACHE, SEPARATION_MODEL_VERSION,
  SEPARATION_MODELS, SEPARATION_SAMPLE_RATE,
  type SeparationInput, type SeparationMessage, type SeparationReport,
} from './separationModel';
import {
  analyzeChunk, addMaskedChunk, CONTEXT_FRAMES, CORE_FRAMES, frameCount, MODEL_BINS, MODEL_FRAMES, ratioMasks,
} from './spectral';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const progress = (stage: string, fraction: number | null = null): void => {
  scope.postMessage({ type: 'progress', stage, fraction } satisfies SeparationMessage);
};

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, import.meta.url).href };
let gpuSubmissionsObserved = 0;
let gpuObservationAvailable = false;
let gpuObservationAttempted = false;

async function modelBytes(index: number): Promise<{ bytes: Uint8Array; fromCache: boolean; cached: boolean }> {
  const model = SEPARATION_MODELS[index]!;
  let cache: Cache | null = null;
  try { cache = await caches.open(SEPARATION_MODEL_CACHE); } catch { /* Private storage can be unavailable. */ }
  const saved = await cache?.match(model.url).catch(() => undefined);
  const response = saved ?? await fetch(model.url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`The stems engine could not download (HTTP ${response.status}). Try again on Wi-Fi.`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('This browser cannot read the stems engine download.');
  const bytes = new Uint8Array(model.bytes);
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes.length) {
      await reader.cancel();
      throw new Error('The stems engine download does not match its expected size.');
    }
    bytes.set(value, offset);
    offset += value.length;
    progress(saved ? 'Reading saved stems engine…' : 'Downloading stems engine…', (index + offset / model.bytes) / 4);
  }
  if (offset !== bytes.length) throw new Error('The stems engine download was interrupted. Try again on Wi-Fi.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== model.sha256) {
    await cache?.delete(model.url).catch(() => false);
    throw new Error('The stems engine integrity check failed. Try Prepare again to download a fresh copy.');
  }
  let cached = !!saved;
  if (cache && !saved) {
    try {
      await cache.put(model.url, new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream' } }));
      cached = true;
    } catch { /* Current preparation still works; the UI receives modelCached=false. */ }
  }
  return { bytes, fromCache: !!saved, cached };
}

async function infer(bytes: Uint8Array, input: Float32Array, provider: 'webgpu' | 'wasm'): Promise<Float32Array> {
  let session: ort.InferenceSession | null = null;
  let tensor: ort.Tensor | null = null;
  let outputs: ort.InferenceSession.ReturnType | null = null;
  try {
    session = await ort.InferenceSession.create(bytes, {
      executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
      graphOptimizationLevel: 'disabled',
    });
    if (provider === 'webgpu' && !gpuObservationAttempted) {
      gpuObservationAttempted = true;
      try {
        const device = await ort.env.webgpu.device as unknown as { queue: { submit: (buffers: unknown) => void } };
        const submit = device.queue.submit.bind(device.queue);
        device.queue.submit = (buffers: unknown): void => { gpuSubmissionsObserved++; submit(buffers); };
        gpuObservationAvailable = true;
      } catch { /* A selected WebGPU session does not establish GPU execution. */ }
    }
    if (!session.inputNames.includes('x') || !session.outputNames.includes('y')) {
      throw new Error('Unexpected stems engine input/output contract.');
    }
    tensor = new ort.Tensor('float32', input, [2, 1, MODEL_FRAMES, MODEL_BINS]);
    outputs = await session.run({ x: tensor });
    const output = outputs.y;
    if (!output || output.type !== 'float32' || output.dims.join(',') !== `2,1,${MODEL_FRAMES},${MODEL_BINS}`) {
      throw new Error('The stems engine returned an unexpected output shape.');
    }
    return new Float32Array(output.data as Float32Array);
  } finally {
    tensor?.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
    if (session) await session.release();
  }
}

async function separate(input: SeparationInput): Promise<void> {
  const start = performance.now();
  if (input.type !== 'separate' || input.sampleRate !== SEPARATION_SAMPLE_RATE || input.channels.length !== 2) {
    throw new Error('Stems preparation requires stereo audio at 44.1 kHz.');
  }
  const total = input.channels[0].length;
  if (total === 0 || total > SEPARATION_SAMPLE_RATE * MAX_SEPARATION_SECONDS || input.channels[1].length !== total) {
    throw new Error(`Choose a song no longer than ${MAX_SEPARATION_SECONDS / 60} minutes for stems.`);
  }
  for (const channel of input.channels) {
    if (channel.some((sample) => !Number.isFinite(sample))) throw new Error('This song contains invalid audio samples.');
  }
  const models: Uint8Array[] = [];
  let modelFromCache = true;
  let modelCached = true;
  for (let i = 0; i < 4; i++) {
    const loaded = await modelBytes(i);
    models.push(loaded.bytes);
    modelFromCache &&= loaded.fromCache;
    modelCached &&= loaded.cached;
  }
  const downloadMs = performance.now() - start;
  // One graph lives at a time. A session is released between stems and chunks rather than
  // retaining four sets of weights, workspaces and GPU allocations on a phone.
  let provider: 'webgpu' | 'wasm' = input.provider !== 'wasm' && 'gpu' in navigator ? 'webgpu' : 'wasm';
  let fallbackReason: string | null = input.provider !== 'wasm' && provider === 'wasm' ? 'WebGPU unavailable; using WASM.' : null;
  const usedProviders = new Set<'webgpu' | 'wasm'>();
  const frames = frameCount(total);
  const chunks = Math.ceil(frames / CORE_FRAMES);
  const stems = Array.from({ length: 8 }, () => new Float32Array(total));
  const separationStart = performance.now();
  for (let index = 0; index < chunks; index++) {
    const coreFirst = index * CORE_FRAMES;
    progress(`Preparing section ${index + 1} of ${chunks}…`, index / chunks);
    const chunk = analyzeChunk(input.channels, coreFirst - CONTEXT_FRAMES);
    const estimates: Float32Array[] = [];
    for (let stem = 0; stem < 4; stem++) {
      progress(`Separating ${SEPARATION_MODELS[stem]!.name} · section ${index + 1} of ${chunks}…`, (index + stem / 4) / chunks);
      let estimate: Float32Array;
      try {
        estimate = await infer(models[stem]!, chunk.magnitudes, provider);
      } catch (error) {
        if (provider === 'wasm') throw error;
        fallbackReason = `WebGPU failed; using WASM: ${error instanceof Error ? error.message : String(error)}`;
        provider = 'wasm';
        estimate = await infer(models[stem]!, chunk.magnitudes, provider);
      }
      usedProviders.add(provider);
      estimates.push(estimate);
    }
    ratioMasks(estimates);
    const coreEnd = CONTEXT_FRAMES + Math.min(CORE_FRAMES, frames - coreFirst);
    for (let stem = 0; stem < 4; stem++) {
      addMaskedChunk(chunk, estimates[stem]!, [stems[stem * 2]!, stems[stem * 2 + 1]!], CONTEXT_FRAMES, coreEnd);
    }
  }
  const report: SeparationReport = {
    modelVersion: SEPARATION_MODEL_VERSION, modelBytes: SEPARATION_MODEL_BYTES,
    modelFromCache, modelCached,
    provider: usedProviders.size > 1 ? 'mixed' : provider,
    gpuSubmissionsObserved: gpuObservationAvailable ? gpuSubmissionsObserved : provider === 'wasm' && !gpuObservationAttempted ? 0 : null,
    fallbackReason, duration: total / SEPARATION_SAMPLE_RATE, chunks,
    downloadMs, separationMs: performance.now() - separationStart, totalMs: performance.now() - start,
  };
  progress('Stems are ready', 1);
  scope.postMessage({ type: 'complete', stems, sampleRate: SEPARATION_SAMPLE_RATE, report } satisfies SeparationMessage,
    stems.map((channel) => channel.buffer as ArrayBuffer));
}

let running = false;
scope.onmessage = (event: MessageEvent<SeparationInput>): void => {
  if (running) return;
  running = true;
  // The owner cancels by terminating this worker, including an in-flight WASM inference.
  void separate(event.data).catch((error: unknown) => {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies SeparationMessage);
  }).finally(() => { scope.close(); });
};
