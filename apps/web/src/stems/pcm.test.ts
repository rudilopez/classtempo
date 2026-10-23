import { describe, expect, it } from 'vitest';
import { decodePcm16, encodePcm16, pcmScale, stemPcmBytes, validateStemChannels } from './pcm';

describe('stored stem PCM', () => {
  it('round-trips silence, both extrema and ordinary samples within int16 precision', () => {
    const source = new Float32Array([-1, -0.73, -0.0001, 0, 0.0001, 0.42, 1]);
    const decoded = decodePcm16(encodePcm16(source), 1);
    expect(decoded[0]).toBe(-1);
    expect(decoded[3]).toBe(0);
    expect(decoded[6]).toBe(1);
    for (let i = 0; i < source.length; i++) expect(Math.abs(decoded[i]! - source[i]!)).toBeLessThan(1 / 32_767);
  });

  it('preserves separated stem peaks instead of clipping them to the output range', () => {
    const source = new Float32Array([-2, -0.5, 0, 1.25]);
    const scale = pcmScale(source);
    const decoded = decodePcm16(encodePcm16(source, scale), scale);
    expect(scale).toBe(2);
    for (let i = 0; i < source.length; i++) expect(Math.abs(decoded[i]! - source[i]!)).toBeLessThan(scale / 32_767);
  });

  it('encodes little endian bytes and reads only the supplied subarray', () => {
    const samples = new Float32Array([0.5, -1, 0, 1, 0.5]);
    expect([...new Uint8Array(encodePcm16(samples.subarray(1, 4)))]).toEqual([0, 128, 0, 0, 255, 127]);
  });

  it('rejects malformed or non-finite audio before producing a saved result', () => {
    for (const sample of [NaN, Infinity, -Infinity]) {
      expect(() => encodePcm16(new Float32Array([sample]))).toThrow('invalid audio');
    }
    expect(() => encodePcm16(new Float32Array([2]), 1)).toThrow('invalid audio');
    expect(() => decodePcm16(new ArrayBuffer(3), 1)).toThrow('Invalid stored');
    expect(() => decodePcm16(new ArrayBuffer(2), Infinity)).toThrow('Invalid stored');
    expect(() => decodePcm16(new ArrayBuffer(2), 1e100)).toThrow('Invalid stored');
  });

  it('requires four aligned stereo pairs and a valid sample rate', () => {
    const channels = Array.from({ length: 8 }, () => new Float32Array(10));
    expect(validateStemChannels(channels, 44_100)).toBe(10);
    expect(stemPcmBytes(10)).toBe(160);
    expect(() => validateStemChannels(channels.slice(0, 7), 44_100)).toThrow('stereo pairs');
    expect(() => validateStemChannels([...channels.slice(0, 7), new Float32Array(9)], 44_100)).toThrow('equal length');
    expect(() => validateStemChannels(channels, 0)).toThrow('sample rate');
    expect(() => validateStemChannels(Array.from({ length: 8 }, () => new Float32Array(0)), 44_100)).toThrow('frame count');
    expect(() => stemPcmBytes(Number.MAX_SAFE_INTEGER)).toThrow('frame count');
  });
});
