import { describe, expect, it } from 'vitest';
import {
  addMaskedChunk, analyzeChunk, assertFiniteEstimate, CONTEXT_FRAMES, CORE_FRAMES, FFT_SIZE, fft, frameCount,
  MODEL_BINS, MODEL_FRAMES, ratioMasks,
} from './spectral';

describe('Spleeter spectral reconstruction', () => {
  it('identifies the actual failed model and never replaces invalid estimates with audio', () => {
    const estimate = new Float32Array([0, 2, NaN, Infinity, -Infinity, 65504]);
    expect(() => assertFiniteEstimate(estimate, 'bass')).toThrow('bass separation model returned invalid audio: 3 non-finite estimates; first index 2');
    expect(Number.isNaN(estimate[2])).toBe(true);
    expect(estimate[3]).toBe(Infinity);
    expect(estimate[4]).toBe(-Infinity);
    expect(() => assertFiniteEstimate(new Float32Array([0, 1, -1, 100000]), 'vocals')).not.toThrow();
  });

  it('inverts the FFT including DC and Nyquist content', () => {
    const original = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.3 + (i % 2 ? 0.2 : -0.2) + Math.sin(i * 0.03));
    const real = original.slice();
    const imaginary = new Float64Array(FFT_SIZE);
    fft(real, imaginary);
    fft(real, imaginary, true);
    for (let i = 0; i < FFT_SIZE; i++) {
      expect(Math.abs(real[i]! - original[i]!)).toBeLessThan(1e-11);
      expect(Math.abs(imaginary[i]!)).toBeLessThan(1e-11);
    }
  });

  it('makes complementary masks for silence and nonzero model outputs', () => {
    const estimates = [new Float32Array([0, 1, 1]), new Float32Array([0, 2, 0]), new Float32Array([0, 3, 0]), new Float32Array([0, 4, 0])];
    ratioMasks(estimates);
    for (let i = 0; i < 3; i++) expect(estimates.reduce((sum, stem) => sum + stem[i]!, 0)).toBeCloseTo(1, 6);
    expect(estimates.map((stem) => stem[0])).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(estimates[3]![1]).toBeCloseTo(16 / 30, 6);
    expect(() => ratioMasks([new Float32Array([NaN]), ...Array.from({ length: 3 }, () => new Float32Array(1))])).toThrow('invalid audio');
  });

  it('keeps silent and one-sample inputs aligned without inventing noise', () => {
    const mask = new Float32Array(2 * MODEL_FRAMES * MODEL_BINS).fill(0.25);
    const output: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
    const chunk = analyzeChunk([new Float32Array([0.8]), new Float32Array([0])], -CONTEXT_FRAMES);
    addMaskedChunk(chunk, mask, output, CONTEXT_FRAMES, CONTEXT_FRAMES + frameCount(1));
    expect(output[0][0]).toBeCloseTo(0.2, 7);
    expect(output[1][0]).toBe(0);
  });

  it('reconstructs both ends and a model-chunk seam without shifted samples or gain changes', () => {
    const length = CORE_FRAMES * 1024 + 719;
    const left = Float32Array.from({ length }, (_, i) => 0.2 * Math.sin(i * 0.019) + 0.1 * Math.cos(i * 1.94));
    const right = Float32Array.from({ length }, (_, i) => 0.3 * Math.sin(i * 0.04));
    left[0] = 0.9;
    right[length - 1] = -0.8;
    const result: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
    const mask = new Float32Array(2 * MODEL_FRAMES * MODEL_BINS).fill(1);
    const frames = frameCount(length);
    for (let first = 0; first < frames; first += CORE_FRAMES) {
      const chunk = analyzeChunk([left, right], first - CONTEXT_FRAMES);
      addMaskedChunk(chunk, mask, result, CONTEXT_FRAMES, CONTEXT_FRAMES + Math.min(CORE_FRAMES, frames - first));
    }
    let maxError = 0;
    for (let i = 0; i < length; i++) maxError = Math.max(maxError, Math.abs(result[0][i]! - left[i]!), Math.abs(result[1][i]! - right[i]!));
    expect(maxError).toBeLessThan(2e-7);
  });
});
