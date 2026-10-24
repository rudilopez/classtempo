import { describe, expect, it, vi } from 'vitest';
import { prepareStemWorker, selectSeparationRuntime, StemPreparationError } from './prepareWorker';
import type { SeparationInput, SeparationMessage, SeparationReport, SeparationRuntime } from './separationModel';

class FakeWorker {
  onmessage: Worker['onmessage'] = null;
  onerror: Worker['onerror'] = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  send(message: SeparationMessage): void { this.onmessage?.call(this as unknown as Worker, { data: message } as MessageEvent); }
}
const input = (): SeparationInput => ({ type: 'separate', channels: [new Float32Array(10), new Float32Array(10)], sampleRate: 44_100 });
const complete = (): Extract<SeparationMessage, { type: 'complete' }> => ({ type: 'complete', stems: Array.from({ length: 8 }, () => new Float32Array(10)),
  sampleRate: 44_100, report: { runtime: 'wasm' } as SeparationReport });
function setup(runtime: SeparationRuntime = 'webgpu-jsep') {
  const workers: FakeWorker[] = [];
  const controller = new AbortController();
  const factory = vi.fn((_runtime: SeparationRuntime) => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  const progress = vi.fn();
  const promise = prepareStemWorker(input(), { runtime, signal: controller.signal, onProgress: progress, createWorker: factory });
  return { workers, controller, factory, promise, progress };
}

describe('stems runtime compatibility', () => {
  it.each([
    ['Mozilla/5.0 (iPhone) AppleWebKit/605 Version/27.0 Mobile Safari/604', 'iPhone', 5],
    ['Mozilla/5.0 (iPhone) AppleWebKit/605 CriOS/140 Mobile Safari/604', 'iPhone', 5],
    ['Mozilla/5.0 (iPad) AppleWebKit/605 FxiOS/141 Mobile Safari/604', 'iPad', 5],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/27.0 Safari/605', 'MacIntel', 5],
    ['Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/27.0 Safari/605', 'MacIntel', 0],
  ])('uses plain WASM on Apple browsers even with GPU present: %s', (userAgent, platform, maxTouchPoints) => {
    expect(selectSeparationRuntime({ userAgent, platform, maxTouchPoints, gpuAvailable: true })).toBe('wasm');
  });
  it('retains GPU on desktop Chromium but uses plain WASM when GPU is absent', () => {
    const environment = { userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537 Chrome/140 Safari/537', platform: 'MacIntel', maxTouchPoints: 0 };
    expect(selectSeparationRuntime({ ...environment, gpuAvailable: true })).toBe('webgpu-jsep');
    expect(selectSeparationRuntime({ ...environment, gpuAvailable: false })).toBe('wasm');
  });
});

describe('isolated stems worker fallback', () => {
  it('terminates poisoned GPU runtime before transferring original PCM to a fresh plain worker', async () => {
    const run = setup();
    const returned = input();
    run.workers[0]!.send({ type: 'retry-wasm', channels: returned.channels, sampleRate: returned.sampleRate,
      cause: 'First GPU initialization failed: compiler limit', runtime: 'webgpu-jsep', runtimeVersion: '1.30.0' });
    expect(run.workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(run.factory.mock.calls.map(([runtime]) => runtime)).toEqual(['webgpu-jsep', 'wasm']);
    expect(run.workers[1]!.postMessage.mock.calls[0]![0].channels).toBe(returned.channels);
    expect(run.workers[1]!.postMessage.mock.calls[0]![0].fallbackReason).toContain('compiler limit');
    run.workers[1]!.send(complete());
    await expect(run.promise).resolves.toHaveProperty('type', 'complete');
    expect(run.workers[1]!.terminate).toHaveBeenCalledOnce();
  });
  it('preserves both original errors instead of a previous-init failure', async () => {
    const run = setup();
    const rejection = expect(run.promise).rejects.toMatchObject({ details: { runtime: 'wasm', message: 'CPU download failed', gpuFailure: 'GPU compile failed' } });
    const returned = input();
    run.workers[0]!.send({ type: 'retry-wasm', channels: returned.channels, sampleRate: returned.sampleRate,
      cause: 'GPU compile failed', runtime: 'webgpu-jsep', runtimeVersion: '1.30.0' });
    run.workers[1]!.send({ type: 'error', message: 'CPU download failed', runtime: 'wasm', runtimeVersion: '1.30.0' });
    await rejection;
    expect(run.factory).toHaveBeenCalledTimes(2);
  });
  it('recovers a numerical GPU failure in a fresh CPU worker and preserves precision diagnostics', async () => {
    const run = setup();
    const returned = input();
    run.workers[0]!.send({ type: 'retry-wasm', channels: returned.channels, sampleRate: returned.sampleRate,
      cause: 'The bass separation model returned invalid audio: 3 non-finite estimates; first index 2.',
      runtime: 'webgpu-jsep', runtimeVersion: '1.30.0' });
    expect(run.workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(run.workers[1]!.postMessage.mock.calls[0]![0].channels).toBe(returned.channels);
    const result = complete();
    result.report.computeVersion = 'fp32-compute-v1';
    result.report.computePrecision = 'float32';
    run.workers[1]!.send(result);
    await expect(run.promise).resolves.toMatchObject({ report: { computePrecision: 'float32', computeVersion: 'fp32-compute-v1' } });
  });
  it('keeps the failed stem and compute version in copyable error details', async () => {
    const run = setup('wasm');
    const rejection = expect(run.promise).rejects.toMatchObject({ details: {
      computeVersion: 'fp32-compute-v1', computePrecision: 'float32',
      stage: 'Separating bass · section 1 of 17…', message: expect.stringContaining('bass separation model'),
    } });
    run.workers[0]!.send({ type: 'progress', stage: 'Separating bass · section 1 of 17…', fraction: 0 });
    run.workers[0]!.send({ type: 'error', message: 'The bass separation model returned invalid audio: 1 non-finite estimate.',
      runtime: 'wasm', runtimeVersion: '1.30.0', computeVersion: 'fp32-compute-v1', computePrecision: 'float32' });
    await rejection;
  });
  it('reports plain-runtime failure without attempting another backend in the same worker', async () => {
    const run = setup('wasm');
    const rejection = expect(run.promise).rejects.toBeInstanceOf(StemPreparationError);
    run.workers[0]!.send({ type: 'error', message: 'CompileError: original cause', runtime: 'wasm', runtimeVersion: '1.30.0' });
    await rejection;
    expect(run.factory).toHaveBeenCalledOnce();
  });
  it('preserves the bounded-memory diagnostic and gives memory-specific recovery advice', async () => {
    const run = setup('wasm');
    const rejection = expect(run.promise).rejects.toMatchObject({ message: expect.stringContaining('Not enough memory'),
      details: { reservedMaxMiB: 256, observedHeapMiB: 16, message: 'RangeError: Out of memory' } });
    run.workers[0]!.send({ type: 'error', message: 'RangeError: Out of memory', runtime: 'wasm', runtimeVersion: '1.30.0',
      reservedMaxMiB: 256, observedHeapMiB: 16 });
    await rejection;
    expect(run.factory).toHaveBeenCalledOnce();
  });
  it('cancels the fallback and ignores already queued completion', async () => {
    const run = setup();
    const source = input();
    run.workers[0]!.send({ type: 'retry-wasm', channels: source.channels, sampleRate: source.sampleRate, cause: 'GPU failed', runtime: 'webgpu-jsep', runtimeVersion: '1.30.0' });
    const stale = run.workers[1]!.onmessage;
    const rejection = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' });
    run.controller.abort();
    stale?.call(run.workers[1] as unknown as Worker, { data: complete() } as MessageEvent);
    await rejection;
    expect(run.workers[1]!.terminate).toHaveBeenCalledOnce();
  });
  it('does not create a worker for an already cancelled preparation', async () => {
    const controller = new AbortController(); controller.abort();
    const factory = vi.fn(() => new FakeWorker());
    await expect(prepareStemWorker(input(), { signal: controller.signal, runtime: 'wasm', onProgress: vi.fn(), createWorker: factory })).rejects.toHaveProperty('name', 'AbortError');
    expect(factory).not.toHaveBeenCalled();
  });
});
