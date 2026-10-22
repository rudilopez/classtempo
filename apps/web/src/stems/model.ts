/** Pinned publisher artifact; keep metadata and SHA-256 together when changing the model. */
export const STEM_MODEL = {
  name: 'HTDemucs 4 stems (fp16-stored weights, fp32 compute)',
  revision: 'd54ed9eb60e258ea82131c6ee14578628816456a',
  bytes: 165_612_636,
  sha256: 'd05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a',
  url: 'https://huggingface.co/StemSplitio/htdemucs-onnx/resolve/d54ed9eb60e258ea82131c6ee14578628816456a/htdemucs_fp16weights.onnx',
  card: 'https://huggingface.co/StemSplitio/htdemucs-onnx/blob/d54ed9eb60e258ea82131c6ee14578628816456a/README.md',
  license: 'Exporter labels its repository MIT; upstream pretrained weights are provided for research. Production weight clearance is unresolved.',
  weightTerms: 'https://github.com/facebookresearch/demucs/issues/508',
} as const;

export const MODEL_CACHE = 'stems-spike-model-v1';
export const SAMPLE_RATE = 44_100;
export const CHUNK_SAMPLES = 343_980;
export const OVERLAP_SAMPLES = Math.floor(CHUNK_SAMPLES / 4);
export const STRIDE_SAMPLES = CHUNK_SAMPLES - OVERLAP_SAMPLES;
export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'] as const;

export type ProviderPreference = 'auto' | 'wasm';

export interface BenchmarkInput {
  channels: [Float32Array, Float32Array];
  provider: ProviderPreference;
}

export interface BenchmarkReport {
  modelRevision: string;
  modelSha256: string;
  modelBytes: number;
  modelFromCache: boolean;
  modelCached: boolean;
  runtimeVersion: string;
  clipSeconds: number;
  chunks: number;
  provider: 'webgpu' | 'wasm';
  gpuSubmissionsObserved: number;
  fallbackReason: string | null;
  downloadMs: number;
  initializationMs: number;
  separationMs: number;
  workerTotalMs: number;
  stemRms: number[];
  previewSamples: number;
  /** Explicitly not total process memory, WASM heap, or GPU memory. */
  peakWorkerJsHeapBytes: number | null;
  ownedPcmBytes: number;
}

export type BenchmarkMessage =
  | { type: 'progress'; stage: string; fraction: number | null }
  | { type: 'complete'; report: BenchmarkReport; previews: Float32Array[] }
  | { type: 'error'; message: string };
