/** Spleeter weights and export are pinned independently of the historical Demucs benchmark. */
export const SEPARATION_MODEL_VERSION = 'spleeter4-4866430-ratio2-ola-v1';
/** Existing finite cached stems stay playable; new inference reports record this numerical correction. */
export const SEPARATION_COMPUTE_VERSION = 'fp32-compute-v1';
export type SeparationPrecision = 'float32' | 'float16';
export const SEPARATION_MODEL_REVISION = '486643021f18a4d057d282fff1d11b89a30e9887';
export const SEPARATION_SAMPLE_RATE = 44_100;
export const MAX_SEPARATION_SECONDS = 270;
export const MAX_SEPARATION_DURATION = `${Math.floor(MAX_SEPARATION_SECONDS / 60)}:${String(MAX_SEPARATION_SECONDS % 60).padStart(2, '0')}`;
export const SEPARATION_MODEL_CACHE = 'classtempo-spleeter-model-v1';
export const SEPARATION_STEM_NAMES = ['vocals', 'drums', 'bass', 'other'] as const;

const MODEL_ROOT = `https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/${SEPARATION_MODEL_REVISION}`;
export const SEPARATION_MODELS = [
  { name: 'vocals', bytes: 19_714_141, sha256: 'db47148ab1c52709ce694893f532c91abfe3edc4d46238939570e036a22878ca' },
  { name: 'drums', bytes: 19_714_140, sha256: '7ae4002e5633634674f74dc3356d5875b0da894d59ce0f60e844bb8f9cb8aa92' },
  { name: 'bass', bytes: 19_714_139, sha256: 'ba4c4949a27222492cca49859901a873b4b71461dc48c7c5a51f93d31eb11f55' },
  { name: 'other', bytes: 19_714_140, sha256: '3cc59116cb7195946ab9596d8ca25984d09c0f8a70db8cf85d063132f97bc61d' },
].map((model) => ({ ...model, url: `${MODEL_ROOT}/${model.name}.fp16.onnx` }));
export const SEPARATION_MODEL_BYTES = SEPARATION_MODELS.reduce((total, model) => total + model.bytes, 0);

export type SeparationRuntime = 'wasm' | 'webgpu-jsep';

export interface SeparationInput {
  type: 'separate';
  channels: [Float32Array, Float32Array];
  sampleRate: number;
  provider?: 'auto' | 'wasm';
  /** Preserves the original GPU failure when a fresh CPU-only Worker retries. */
  fallbackReason?: string;
}

export interface SeparationReport {
  computeVersion: string;
  computePrecision: SeparationPrecision;
  reservedMaxMiB?: number;
  observedHeapMiB?: number | null;
  runtime: SeparationRuntime;
  runtimeVersion: string;
  modelVersion: string;
  modelBytes: number;
  modelFromCache: boolean;
  modelCached: boolean;
  /** Selected session path; some operators can still run on WASM. */
  provider: 'webgpu' | 'wasm' | 'mixed';
  /** null means this browser prevented queue observation, not zero GPU work. */
  gpuSubmissionsObserved: number | null;
  fallbackReason: string | null;
  duration: number;
  chunks: number;
  downloadMs: number;
  separationMs: number;
  totalMs: number;
}

export type SeparationMessage =
  | { type: 'progress'; stage: string; fraction: number | null }
  | { type: 'complete'; stems: Float32Array[]; sampleRate: number; report: SeparationReport }
  | { type: 'retry-wasm'; channels: [Float32Array, Float32Array]; sampleRate: number; cause: string; runtime: 'webgpu-jsep'; runtimeVersion: string }
  | { type: 'error'; message: string; runtime: SeparationRuntime; runtimeVersion: string; computeVersion?: string; computePrecision?: SeparationPrecision; reservedMaxMiB?: number; observedHeapMiB?: number | null };
