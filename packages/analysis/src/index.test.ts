import { describe, expect, it } from 'vitest';
import { beatBefore, detectTempo, overviewPeaks } from './index';

function clickTrack(bpm: number, seconds: number, sampleRate: number, offsetSec = 0.25): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  const beat = (60 / bpm) * sampleRate;
  const clickLen = Math.floor(sampleRate * 0.01);
  for (let t = offsetSec * sampleRate; t < out.length; t += beat) {
    const start = Math.round(t);
    for (let i = 0; i < clickLen && start + i < out.length; i++) {
      out[start + i] = Math.sin((i / sampleRate) * 2 * Math.PI * 1500) * Math.exp(-i / (clickLen / 4));
    }
  }
  return out;
}

describe('detectTempo', () => {
  it('finds 128 BPM on a click track', () => {
    const sr = 44100;
    const r = detectTempo(clickTrack(128, 30, sr), sr);
    expect(Math.abs(r.bpm - 128)).toBeLessThan(0.5);
    expect(r.confidence).toBeGreaterThan(2);
  });

  it('finds 174 BPM (DnB) without halving it', () => {
    const sr = 48000;
    const r = detectTempo(clickTrack(174, 30, sr), sr);
    expect(Math.abs(r.bpm - 174)).toBeLessThan(0.5);
  });

  it('locks beat phase to the click offset', () => {
    const sr = 44100;
    const r = detectTempo(clickTrack(120, 20, sr, 0.3), sr);
    const beat = 60 / 120;
    const phase = ((r.firstBeat - 0.3) % beat + beat) % beat;
    expect(Math.min(phase, beat - phase)).toBeLessThan(0.03);
  });

  it('returns zero confidence for silence', () => {
    const r = detectTempo(new Float32Array(44100 * 10), 44100);
    expect(r.bpm === 0 || r.confidence < 1.5).toBe(true);
  });
});

describe('overviewPeaks', () => {
  it('produces the requested number of columns', () => {
    const mono = new Float32Array(10000).map((_, i) => Math.sin(i / 10));
    expect(overviewPeaks(mono, 100).length).toBe(100);
    expect(overviewPeaks(mono, 100)[50]).toBeGreaterThan(0.9);
  });
});

describe('beatBefore', () => {
  it('snaps to the grid', () => {
    expect(beatBefore(10.1, 120, 0.25)).toBeCloseTo(9.75, 6);
    expect(beatBefore(0.1, 120, 0.25)).toBeCloseTo(-0.25, 6);
  });
});
