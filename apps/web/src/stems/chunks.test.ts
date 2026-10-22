import { describe, expect, it } from 'vitest';
import { chunkOffsets, overlapWindow, StreamingOverlapAdd } from './chunks';

describe('stems benchmark chunking', () => {
  it('covers the exact end without a redundant final overlapping chunk', () => {
    expect(chunkOffsets(8, 8, 6)).toEqual([0]);
    expect(chunkOffsets(14, 8, 6)).toEqual([0, 6]);
    expect(chunkOffsets(15, 8, 6)).toEqual([0, 6, 12]);
  });

  it('reconstructs constant stems through overlaps and both track boundaries', () => {
    const overlap = new StreamingOverlapAdd(2, 8, 6, 15);
    const window = overlapWindow(8, 2);
    const data = new Float32Array(16);
    data.fill(0.25, 0, 8);
    data.fill(-0.5, 8);
    overlap.add(data, 8, false, window);
    overlap.add(data, 8, false, window);
    overlap.add(data, 3, true, window);
    expect([...overlap.preview[0]!]).toEqual(Array(15).fill(0.25));
    expect([...overlap.preview[1]!]).toEqual(Array(15).fill(-0.5));
    expect(overlap.rms).toEqual([0.25, 0.5]);
  });

  it('rejects a non-finite model output instead of reporting a successful benchmark', () => {
    const overlap = new StreamingOverlapAdd(1, 8, 6, 8);
    const data = new Float32Array(8);
    data[3] = Number.NaN;
    expect(() => overlap.add(data, 8, true, overlapWindow(8, 2))).toThrow('non-finite');
  });

  it('keeps time-varying audio aligned across a partial final chunk', () => {
    const overlap = new StreamingOverlapAdd(1, 8, 6, 15);
    const window = overlapWindow(8, 2);
    for (const offset of chunkOffsets(15, 8, 6)) {
      const data = Float32Array.from({ length: 8 }, (_, index) => (offset + index) / 16);
      overlap.add(data, Math.min(8, 15 - offset), offset === 12, window);
    }
    overlap.preview[0]!.forEach((sample, index) => expect(sample).toBeCloseTo(index / 16, 6));
  });
});
