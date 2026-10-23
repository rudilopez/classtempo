import type { SeparationInput, SeparationMessage, SeparationRuntime } from './separationModel';

type Completed = Extract<SeparationMessage, { type: 'complete' }>;
type WorkerHandle = Pick<Worker, 'postMessage' | 'terminate' | 'onerror' | 'onmessage'>;
type WorkerFactory = (runtime: SeparationRuntime) => WorkerHandle;

export interface StemFailureDetails {
  runtime: SeparationRuntime;
  runtimeVersion: string;
  stage: string;
  message: string;
  gpuFailure?: string;
  reservedMaxMiB?: number;
  observedHeapMiB?: number | null;
}

export class StemPreparationError extends Error {
  constructor(readonly details: StemFailureDetails) {
    super(/out of memory|memory access out of bounds|allocation failed/i.test(details.message)
      ? 'Not enough memory to prepare stems. Close other tabs and reopen ClassTempo before trying again. Your original song is available.'
      : 'Stems could not be prepared on this device. Try again, or copy details if it repeats. Your original song is available.');
    this.name = 'StemPreparationError';
  }
}

/** All iOS browsers use the conservative path, including iPad's desktop browser identity. */
export function selectSeparationRuntime(environment: {
  userAgent: string; platform: string; maxTouchPoints: number; gpuAvailable: boolean;
}): SeparationRuntime {
  const { userAgent, platform, maxTouchPoints, gpuAvailable } = environment;
  const appleMobile = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const safari = /Safari\//.test(userAgent) && !/Chrome|Chromium|Edg|OPR|Android/.test(userAgent);
  return appleMobile || safari || !gpuAvailable ? 'wasm' : 'webgpu-jsep';
}

const createWorker: WorkerFactory = (runtime) => runtime === 'wasm'
  ? new Worker(new URL('./separate-wasm.worker.ts', import.meta.url), { type: 'module' })
  : new Worker(new URL('./separate.worker.ts', import.meta.url), { type: 'module' });

/** A failed GPU runtime must never be reused for CPU fallback: its initialization is permanently aborted. */
export function prepareStemWorker(input: SeparationInput, options: {
  runtime: SeparationRuntime;
  signal: AbortSignal;
  onProgress: (stage: string, fraction: number | null) => void;
  createWorker?: WorkerFactory;
}): Promise<Completed> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    let active: WorkerHandle | null = null;
    let runtime = options.runtime;
    let stage = 'Starting stems engine';
    let gpuFailure: string | undefined;
    let settled = false;
    const stopWorker = (): void => {
      if (!active) return;
      active.onmessage = null;
      active.onerror = null;
      active.terminate();
      active = null;
    };
    const finish = (): void => {
      settled = true;
      stopWorker();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = (): void => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    const fail = (message: string, runtimeVersion = '1.30.0', memory: { reservedMaxMiB?: number; observedHeapMiB?: number | null } = {}): void => {
      finish();
      reject(new StemPreparationError({ runtime, runtimeVersion, stage, message: message.slice(0, 4000), gpuFailure, ...memory }));
    };
    const start = (request: SeparationInput): void => {
      if (signal.aborted) { onAbort(); return; }
      try {
        const worker = (options.createWorker ?? createWorker)(runtime);
        active = worker;
        worker.onerror = (event) => {
          if (settled || active !== worker) return;
          fail(event.message || 'The stems worker stopped before returning a result.');
        };
        worker.onmessage = (event: MessageEvent<SeparationMessage>) => {
          if (settled || signal.aborted || active !== worker) return;
          const message = event.data;
          if (message.type === 'progress') { stage = message.stage; onProgress(message.stage, message.fraction); }
          else if (message.type === 'retry-wasm') {
            if (runtime !== 'webgpu-jsep') { fail(message.cause, message.runtimeVersion); return; }
            gpuFailure = message.cause.slice(0, 4000);
            stopWorker();
            runtime = 'wasm';
            stage = 'Starting compatible stems engine…';
            onProgress(stage, null);
            start({ ...input, channels: message.channels, sampleRate: message.sampleRate, provider: 'wasm', fallbackReason: gpuFailure });
          } else if (message.type === 'error') fail(message.message, message.runtimeVersion,
            { reservedMaxMiB: message.reservedMaxMiB, observedHeapMiB: message.observedHeapMiB });
          else { finish(); resolve(message); }
        };
        worker.postMessage(request, [...new Set(request.channels.map((channel) => channel.buffer))]);
      } catch (error) { fail(error instanceof Error ? error.message : String(error)); }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    start({ ...input, provider: runtime === 'wasm' ? 'wasm' : 'auto' });
  });
}
