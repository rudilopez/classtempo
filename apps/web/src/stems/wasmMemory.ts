/** The pinned Spleeter graph uses about 207 MiB; avoid reserving ORT's default 4 GiB on iOS. */
export const STEMS_WASM_MAX_MIB = 256;
export const STEMS_WASM_MAX_BYTES = STEMS_WASM_MAX_MIB * 1024 * 1024;
export const STEMS_ORT_VERSION = '1.30.0';

interface StemsWorkerGlobal {
  /** Set by the checked build adapter when the plain runtime creates its own memory. */
  __classTempoStemsWasmMemory?: WebAssembly.Memory;
}

/** Worker-local diagnostic only. This never allocates memory or changes WebAssembly constructors. */
export function getStemsWasmMemoryStats(): { reservedMaxMiB: number; observedHeapMiB: number | null } {
  const memory = (globalThis as typeof globalThis & StemsWorkerGlobal).__classTempoStemsWasmMemory;
  return {
    reservedMaxMiB: STEMS_WASM_MAX_MIB,
    observedHeapMiB: memory ? memory.buffer.byteLength / (1024 * 1024) : null,
  };
}
