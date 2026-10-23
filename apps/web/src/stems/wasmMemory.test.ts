import { describe, expect, it } from 'vitest';
import original from '../../../../node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs?raw';
import { capOrtWasmSource, cappedOrtWasm } from '../../build/cappedOrtWasm';
import { getStemsWasmMemoryStats, STEMS_WASM_MAX_BYTES } from './wasmMemory';

describe('plain ONNX memory cap', () => {
  it('adapts the exact pinned bundle to 256 MiB and aligned heap growth', async () => {
    const bounded = await capOrtWasmSource(original);
    expect(bounded).toContain('globalThis.__classTempoStemsWasmMemory=new WebAssembly.Memory({initial:256,maximum:4096,shared:!0})');
    expect(bounded).not.toContain('maximum:65536');
    expect(bounded).not.toContain('4294901760');
    expect(bounded.split(String(STEMS_WASM_MAX_BYTES))).toHaveLength(4);
  });

  it('fails closed on upstream source or version drift', async () => {
    await expect(capOrtWasmSource(original + '\n')).rejects.toThrow('runtime changed');
    await expect(capOrtWasmSource(original.replace('v1.30.0', 'v1.31.0'))).rejects.toThrow('runtime changed');
    await expect(capOrtWasmSource(original.replace('maximum:65536', 'maximum:32768'))).rejects.toThrow('runtime changed');
  });

  it('only targets the plain runtime, never JSEP or unrelated code', async () => {
    const plugin = cappedOrtWasm();
    const transform = plugin.transform;
    if (typeof transform !== 'function') throw new Error('Expected the plain transform hook');
    const invoke = (source: string, id: string) => transform.call({} as never, source, id);
    expect(await invoke(original, '/repo/node_modules/onnxruntime-web/dist/ort.bundle.min.mjs')).toBeNull();
    expect(await invoke(original, '/repo/src/player.mjs')).toBeNull();
    expect(await invoke(original, '/repo/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs')).toHaveProperty('code');
    expect(await invoke(original, '/repo/node_modules/onnxruntime-web/dist/ort.wasm.bundle.min.mjs?v=dev-cache')).toHaveProperty('code');
  });

  it('reports the reserved limit without allocating a memory object', () => {
    expect(getStemsWasmMemoryStats()).toEqual({ reservedMaxMiB: 256, observedHeapMiB: null });
  });

  it('fails the worker build when changed module resolution bypasses the adapter', () => {
    const hook = cappedOrtWasm().generateBundle;
    if (typeof hook !== 'function') throw new Error('Expected the build verification hook');
    const context = { error: (message: string) => { throw new Error(message); } };
    const bundle = { 'worker.js': { type: 'chunk', facadeModuleId: '/repo/src/stems/separate-wasm.worker.ts' } };
    expect(() => hook.call(context as never, {} as never, bundle as never, false)).toThrow('without its checked ONNX memory cap');
  });
});
