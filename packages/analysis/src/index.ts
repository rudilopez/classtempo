/**
 * Phase 0 analysis: tempo + beat phase + overview waveform. Pure functions, no DOM, so they run in a
 * Worker or in Node tests. Phase 1 adds variable beatgrids; Phase 2 adds key/loudness via Essentia.js.
 */

export interface TempoResult {
  bpm: number;
  /** seconds: a beat falls here; the grid is firstBeat + k * 60 / bpm */
  firstBeat: number;
  /** peak score / mean score — > ~3 is a confident, steady-tempo track */
  confidence: number;
}

export interface AnalysisResult extends TempoResult {
  /** max |sample| per column, 0..1 */
  peaks: Float32Array;
  duration: number;
}

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** analysis hop in samples */
  hop?: number;
}

export function downmix(channels: ArrayLike<Float32Array>): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first.slice();
  const n = first.length;
  const mono = new Float32Array(n);
  const scale = 1 / channels.length;
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c]!;
    for (let i = 0; i < n; i++) mono[i] = (mono[i] ?? 0) + ch[i]! * scale;
  }
  return mono;
}

export function overviewPeaks(mono: Float32Array, columns = 800): Float32Array {
  const peaks = new Float32Array(columns);
  if (mono.length === 0) return peaks;
  const per = mono.length / columns;
  for (let c = 0; c < columns; c++) {
    const start = Math.floor(c * per);
    const end = Math.min(mono.length, Math.floor((c + 1) * per));
    let max = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(mono[i]!);
      if (v > max) max = v;
    }
    peaks[c] = max;
  }
  return peaks;
}

/** Half-wave-rectified log-energy difference per hop — a cheap onset-strength envelope. */
function onsetEnvelope(mono: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(mono.length / hop);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = mono[base + i]!;
      sum += v * v;
    }
    energy[f] = Math.log1p(1000 * Math.sqrt(sum / hop));
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f]! - energy[f - 1]!;
    onset[f] = d > 0 ? d : 0;
  }
  // remove slow trends so sustained loudness changes don't masquerade as beats
  const win = 16;
  let acc = 0;
  const smoothed = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    acc += onset[f]!;
    if (f >= win) acc -= onset[f - win]!;
    smoothed[f] = Math.max(0, onset[f]! - acc / win);
  }
  return smoothed;
}

/** Autocorrelation at an integer lag, normalised by the number of terms. */
function acfAt(onset: Float32Array, lag: number): number {
  const limit = onset.length - lag;
  if (limit <= 0) return 0;
  let sum = 0;
  for (let f = 0; f < limit; f++) {
    const o = onset[f]!;
    if (o !== 0) sum += o * onset[f + lag]!;
  }
  return sum / limit;
}

/**
 * Log-normal tempo prior (Ellis 2007) centred on 130 BPM. Autocorrelation cannot tell a beat from
 * its half-time, so ties resolve toward DJ tempos: 87/174 → 174, 64/128 → 128. Phase 1's beatgrid
 * editor adds ×2 / ÷2 for the cases where that guess is wrong.
 */
function tempoPrior(bpm: number): number {
  const x = Math.log2(bpm / 130) / 0.9;
  return Math.exp(-0.5 * x * x);
}

/** Sub-sample peak position from the three values around a local maximum. */
function parabolicPeak(y0: number, y1: number, y2: number): number {
  const d = y0 - 2 * y1 + y2;
  return d === 0 ? 0 : (0.5 * (y0 - y2)) / d;
}

/**
 * Least-squares fit of a constant-tempo grid to the strongest onset near each predicted beat.
 * Averages out the hop-size quantisation of the envelope, giving ~0.01 BPM precision on steady tracks.
 */
function refineGrid(onset: Float32Array, period: number, phase: number, iterations = 3): { period: number; phase: number } {
  const n = onset.length;
  const initial = period;
  for (let it = 0; it < iterations; it++) {
    const window = Math.max(1, Math.floor(period * 0.15));
    let sw = 0;
    let swk = 0;
    let swt = 0;
    let swkk = 0;
    let swkt = 0;
    for (let k = 0, t = phase; t < n - 1; k++, t += period) {
      const c = Math.round(t);
      let bestI = -1;
      let bestV = 0;
      for (let i = Math.max(1, c - window); i <= Math.min(n - 2, c + window); i++) {
        const v = onset[i]!;
        if (v > bestV) {
          bestV = v;
          bestI = i;
        }
      }
      if (bestI < 0) continue;
      const tk = bestI + parabolicPeak(onset[bestI - 1]!, onset[bestI]!, onset[bestI + 1]!);
      sw += bestV;
      swk += bestV * k;
      swt += bestV * tk;
      swkk += bestV * k * k;
      swkt += bestV * k * tk;
    }
    const denom = sw * swkk - swk * swk;
    if (sw === 0 || denom === 0) break;
    const slope = (sw * swkt - swk * swt) / denom;
    if (Math.abs(slope / initial - 1) > 0.05) break; // fit ran away; keep the coarse estimate
    period = slope;
    phase = (swt - slope * swk) / sw;
  }
  phase = ((phase % period) + period) % period;
  return { period, phase };
}

export function detectTempo(mono: Float32Array, sampleRate: number, opts: TempoOptions = {}): TempoResult {
  const { minBpm = 70, maxBpm = 180, hop = 512 } = opts;
  const frameRate = sampleRate / hop;
  const onset = onsetEnvelope(mono, hop);
  if (onset.length < frameRate * 2) return { bpm: 0, firstBeat: 0, confidence: 0 };

  // 1. coarse: integer-lag autocorrelation weighted by the tempo prior
  const minLag = Math.max(2, Math.floor((60 / maxBpm) * frameRate));
  const maxLag = Math.ceil((60 / minBpm) * frameRate);
  const acf = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) acf[lag] = acfAt(onset, lag);

  let bestLag = minLag;
  let bestScore = -1;
  let total = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const s = acf[lag]! * tempoPrior((60 * frameRate) / lag);
    total += s;
    count++;
    if (s > bestScore) {
      bestScore = s;
      bestLag = lag;
    }
  }
  const mean = count ? total / count : 0;
  const confidence = mean > 0 ? bestScore / mean : 0;
  if (bestScore <= 0) return { bpm: 0, firstBeat: 0, confidence: 0 };

  // 2. sub-frame lag, then the beat phase that collects the most onset energy
  let period = bestLag + parabolicPeak(acf[bestLag - 1]!, acf[bestLag]!, acf[bestLag + 1]!);
  let phase = 0;
  let bestPhaseScore = -1;
  for (let p = 0; p < Math.round(period); p++) {
    let s = 0;
    for (let t = p; t < onset.length; t += period) s += onset[Math.round(t)] ?? 0;
    if (s > bestPhaseScore) {
      bestPhaseScore = s;
      phase = p;
    }
  }

  // 3. least-squares grid fit for precision
  ({ period, phase } = refineGrid(onset, period, phase));

  return {
    bpm: Math.round(((60 * frameRate) / period) * 100) / 100,
    firstBeat: (phase * hop) / sampleRate,
    confidence,
  };
}

export function analyze(mono: Float32Array, sampleRate: number, columns = 800): AnalysisResult {
  return {
    ...detectTempo(mono, sampleRate),
    peaks: overviewPeaks(mono, columns),
    duration: mono.length / sampleRate,
  };
}

/** Nearest grid beat at or before `t`. */
export function beatBefore(t: number, bpm: number, firstBeat: number): number {
  const beat = 60 / bpm;
  return firstBeat + Math.floor((t - firstBeat) / beat) * beat;
}
