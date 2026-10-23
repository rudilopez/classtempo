import type * as Ort from 'onnxruntime-web';
import {
  MAX_SEPARATION_SECONDS, MAX_SEPARATION_DURATION, SEPARATION_MODEL_BYTES, SEPARATION_MODEL_CACHE, SEPARATION_MODEL_VERSION,
  SEPARATION_MODELS, SEPARATION_SAMPLE_RATE,
  type SeparationInput, type SeparationMessage, type SeparationReport, type SeparationRuntime,
} from './separationModel';
import {
  analyzeChunk, addMaskedChunk, CONTEXT_FRAMES, CORE_FRAMES, frameCount, MODEL_BINS, MODEL_FRAMES, ratioMasks,
} from './spectral';
import { getStemsWasmMemoryStats } from './wasmMemory';

type OrtApi = typeof Ort;

class RetryWasmError extends Error {}

/** Runtime imports live in separate Worker entries: a failed GPU init must never poison CPU recovery. */
export function installSeparationWorker(
  scope: DedicatedWorkerGlobalScope,
  ort: OrtApi,
  runtime: SeparationRuntime,
): void {
  const provider = runtime === 'webgpu-jsep' ? 'webgpu' : 'wasm';
  const runtimeVersion = ort.env.versions.web ?? 'unknown';
  const progress = (stage: string, fraction: number | null = null): void => {
    scope.postMessage({ type: 'progress', stage, fraction } satisfies SeparationMessage);
  };
  let gpuSubmissionsObserved = 0;
  let gpuObservationAvailable = false;
  let gpuObservationAttempted = false;

  async function modelBytes(index: number, announce: boolean): Promise<{ bytes: Uint8Array; fromCache: boolean; cached: boolean }> {
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
      if (announce || !saved) progress(saved ? 'Reading saved stems engine…' : 'Downloading stems engine…', (index + offset / model.bytes) / 4);
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

  async function infer(bytes: Uint8Array, input: Float32Array, executionProvider: 'webgpu' | 'wasm'): Promise<Float32Array> {
    let session: Ort.InferenceSession | null = null;
    let tensor: Ort.Tensor | null = null;
    let outputs: Ort.InferenceSession.ReturnType | null = null;
    let failed = false;
    try {
      session = await ort.InferenceSession.create(bytes, {
        // One backend preserves the actual first initialization error. Recovery gets a new CPU-only Worker.
        executionProviders: [executionProvider],
        graphOptimizationLevel: 'disabled',
      });
      if (executionProvider === 'webgpu' && !gpuObservationAttempted) {
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
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      // A cleanup failure must not replace the real initialization/inference error needed for diagnosis.
      let cleanupError: unknown;
      try { tensor?.dispose(); } catch (error) { cleanupError = error; }
      if (outputs) for (const output of Object.values(outputs)) {
        try { output.dispose(); } catch (error) { cleanupError ??= error; }
      }
      try { await session?.release(); } catch (error) { cleanupError ??= error; }
      if (!failed && cleanupError !== undefined) throw cleanupError;
    }
  }

  async function separate(input: SeparationInput): Promise<void> {
    const start = performance.now();
    if (input.type !== 'separate' || input.sampleRate !== SEPARATION_SAMPLE_RATE || input.channels.length !== 2) {
      throw new Error('Stems preparation requires stereo audio at 44.1 kHz.');
    }
    const total = input.channels[0].length;
    if (total === 0 || total > SEPARATION_SAMPLE_RATE * MAX_SEPARATION_SECONDS || input.channels[1].length !== total) {
      throw new Error(`Choose a song up to ${MAX_SEPARATION_DURATION} long for stems.`);
    }
    for (const channel of input.channels) {
      if (channel.some((sample) => !Number.isFinite(sample))) throw new Error('This song contains invalid audio samples.');
    }
    // Keep only one model in JS memory when CacheStorage is available. A failed cache write retains
    // that model for this preparation, so storage denial never causes downloads on every chunk.
    const unsavedModels = new Map<number, Uint8Array>();
    let modelFromCache = true;
    let modelCached = true;
    let downloadMs = 0;
    // One graph lives at a time. A session is released between stems and chunks rather than
    // retaining four sets of weights, workspaces and GPU allocations on a phone.
    const fallbackReason = input.fallbackReason ?? null;
    const frames = frameCount(total);
    const chunks = Math.ceil(frames / CORE_FRAMES);
    // Compile and run the real first chunk before allocating the full-song output (~381 MB at 4:30).
    // This avoids overlapping the compiler's peak memory with every output channel; no dummy warmup is needed.
    let stems: Float32Array[] | null = null;
    const separationStart = performance.now();
    for (let index = 0; index < chunks; index++) {
      const coreFirst = index * CORE_FRAMES;
      progress(`Preparing section ${index + 1} of ${chunks}…`, index / chunks);
      const chunk = analyzeChunk(input.channels, coreFirst - CONTEXT_FRAMES);
      const estimates: Float32Array[] = [];
      for (let stem = 0; stem < 4; stem++) {
        const loadStart = performance.now();
        let bytes = unsavedModels.get(stem);
        if (!bytes) {
          const loaded = await modelBytes(stem, index === 0);
          bytes = loaded.bytes;
          modelFromCache &&= loaded.fromCache;
          modelCached &&= loaded.cached;
          if (!loaded.cached) unsavedModels.set(stem, bytes);
        }
        downloadMs += performance.now() - loadStart;
        progress(`Separating ${SEPARATION_MODELS[stem]!.name} · section ${index + 1} of ${chunks}…`, (index + stem / 4) / chunks);
        let estimate: Float32Array;
        try {
          estimate = await infer(bytes, chunk.magnitudes, provider);
        } catch (error) {
          if (provider === 'wasm') throw error;
          throw new RetryWasmError(error instanceof Error ? error.message : String(error));
        }
        estimates.push(estimate);
      }
      stems ??= Array.from({ length: 8 }, () => new Float32Array(total));
      ratioMasks(estimates);
      const coreEnd = CONTEXT_FRAMES + Math.min(CORE_FRAMES, frames - coreFirst);
      for (let stem = 0; stem < 4; stem++) {
        addMaskedChunk(chunk, estimates[stem]!, [stems[stem * 2]!, stems[stem * 2 + 1]!], CONTEXT_FRAMES, coreEnd);
      }
    }
    if (!stems) throw new Error('This song has no audio sections to separate.');
    const report: SeparationReport = {
      modelVersion: SEPARATION_MODEL_VERSION, modelBytes: SEPARATION_MODEL_BYTES,
      modelFromCache, modelCached,
      provider, runtime, runtimeVersion,
      ...(runtime === 'wasm' ? getStemsWasmMemoryStats() : {}),
      gpuSubmissionsObserved: gpuObservationAvailable ? gpuSubmissionsObserved : provider === 'wasm' && !gpuObservationAttempted ? 0 : null,
      fallbackReason, duration: total / SEPARATION_SAMPLE_RATE, chunks,
      downloadMs, separationMs: performance.now() - separationStart - downloadMs, totalMs: performance.now() - start,
    };
    progress('Stems are ready', 1);
    scope.postMessage({ type: 'complete', stems, sampleRate: SEPARATION_SAMPLE_RATE, report } satisfies SeparationMessage,
      stems.map((channel) => channel.buffer as ArrayBuffer));
  }

  let running = false;
  scope.onmessage = (event: MessageEvent<SeparationInput>): void => {
    if (running) return;
    running = true;
    progress('Starting stems engine…');
    // The owner cancels by terminating this worker, including an in-flight WASM inference.
    void separate(event.data).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RetryWasmError && runtime === 'webgpu-jsep') {
        // Return ownership of the original decoded PCM so CPU retry needs neither a copy nor another decode.
        scope.postMessage({
          type: 'retry-wasm', channels: event.data.channels, sampleRate: event.data.sampleRate,
          cause: message, runtime, runtimeVersion,
        } satisfies SeparationMessage, [...new Set(event.data.channels.map((channel) => channel.buffer as ArrayBuffer))]);
      } else {
        scope.postMessage({ type: 'error', message, runtime, runtimeVersion,
          ...(runtime === 'wasm' ? getStemsWasmMemoryStats() : {}) } satisfies SeparationMessage);
      }
    }).finally(() => { scope.close(); });
  };
}
