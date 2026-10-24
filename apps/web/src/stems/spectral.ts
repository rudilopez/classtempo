/** Spleeter's periodic Hann STFT, plus a weighted overlap-add inverse. */
export const FFT_SIZE = 4096;
export const HOP_SIZE = 1024;
export const SPECTRUM_BINS = FFT_SIZE / 2 + 1;
export const MODEL_BINS = 1024;
export const MODEL_FRAMES = 512;
export const CONTEXT_FRAMES = 32;
export const CORE_FRAMES = MODEL_FRAMES - CONTEXT_FRAMES * 2;
const FRONT_PAD = FFT_SIZE - HOP_SIZE;

const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE));
const reversed = new Uint16Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  let input = i;
  let result = 0;
  for (let bit = 0; bit < 12; bit++) { result = result * 2 + (input & 1); input >>= 1; }
  reversed[i] = result;
}
const cos = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.cos(2 * Math.PI * i / FFT_SIZE));
const sin = Float64Array.from({ length: FFT_SIZE / 2 }, (_, i) => Math.sin(2 * Math.PI * i / FFT_SIZE));

export function fft(real: Float64Array, imaginary: Float64Array, inverse = false): void {
  if (real.length !== FFT_SIZE || imaginary.length !== FFT_SIZE) throw new Error('Invalid FFT size');
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = reversed[i]!;
    if (j <= i) continue;
    [real[i], real[j]] = [real[j]!, real[i]!];
    [imaginary[i], imaginary[j]] = [imaginary[j]!, imaginary[i]!];
  }
  for (let size = 2; size <= FFT_SIZE; size *= 2) {
    const half = size / 2;
    const stride = FFT_SIZE / size;
    for (let base = 0; base < FFT_SIZE; base += size) {
      for (let k = 0; k < half; k++) {
        const a = base + k;
        const b = a + half;
        const c = cos[k * stride]!;
        const s = sin[k * stride]! * (inverse ? 1 : -1);
        const re = c * real[b]! - s * imaginary[b]!;
        const im = s * real[b]! + c * imaginary[b]!;
        real[b] = real[a]! - re;
        imaginary[b] = imaginary[a]! - im;
        real[a] = real[a]! + re;
        imaginary[a] = imaginary[a]! + im;
      }
    }
  }
  if (inverse) for (let i = 0; i < FFT_SIZE; i++) { real[i] = real[i]! / FFT_SIZE; imaginary[i] = imaginary[i]! / FFT_SIZE; }
}

export interface SpectralChunk {
  firstFrame: number;
  real: Float32Array;
  imaginary: Float32Array;
  magnitudes: Float32Array;
}

export function frameCount(samples: number): number {
  return Math.ceil((FRONT_PAD + samples) / HOP_SIZE);
}

export function analyzeChunk(channels: [Float32Array, Float32Array], firstFrame: number): SpectralChunk {
  const spectrumLength = 2 * MODEL_FRAMES * SPECTRUM_BINS;
  const chunk: SpectralChunk = {
    firstFrame, real: new Float32Array(spectrumLength), imaginary: new Float32Array(spectrumLength),
    magnitudes: new Float32Array(2 * MODEL_FRAMES * MODEL_BINS),
  };
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  for (let channel = 0; channel < 2; channel++) {
    const source = channels[channel]!;
    for (let frame = 0; frame < MODEL_FRAMES; frame++) {
      const globalFrame = firstFrame + frame;
      // Model context outside the real STFT frame range is padding, not extra signal.
      if (globalFrame < 0 || globalFrame >= frameCount(source.length)) continue;
      const start = globalFrame * HOP_SIZE - FRONT_PAD;
      imaginary.fill(0);
      for (let i = 0; i < FFT_SIZE; i++) real[i] = (source[start + i] ?? 0) * window[i]!;
      fft(real, imaginary);
      const spectrumOffset = (channel * MODEL_FRAMES + frame) * SPECTRUM_BINS;
      const modelOffset = (channel * MODEL_FRAMES + frame) * MODEL_BINS;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        chunk.real[spectrumOffset + bin] = real[bin]!;
        chunk.imaginary[spectrumOffset + bin] = imaginary[bin]!;
        if (bin < MODEL_BINS) chunk.magnitudes[modelOffset + bin] = Math.hypot(real[bin]!, imaginary[bin]!);
      }
    }
  }
  return chunk;
}

/** Reject a failed graph before allocating full-song output or hiding the stem behind a later progress label. */
export function assertFiniteEstimate(estimate: Float32Array, stem: string): void {
  let invalidCount = 0;
  let firstInvalid = -1;
  for (let i = 0; i < estimate.length; i++) {
    if (Number.isFinite(estimate[i])) continue;
    invalidCount++;
    if (firstInvalid < 0) firstInvalid = i;
  }
  if (invalidCount) {
    throw new Error(`The ${stem} separation model returned invalid audio: ${invalidCount} non-finite estimates; first index ${firstInvalid}.`);
  }
}

/** Convert estimates to complementary masks in place; every frequency sums to one. */
export function ratioMasks(estimates: Float32Array[]): void {
  if (estimates.length !== 4 || estimates.some((stem) => stem.length !== estimates[0]!.length)) {
    throw new Error('Four matching stem estimates are required');
  }
  for (let i = 0; i < estimates[0]!.length; i++) {
    let total = 1e-10;
    for (const stem of estimates) {
      if (!Number.isFinite(stem[i])) throw new Error('The separation model returned invalid audio');
      total += stem[i]! ** 2;
    }
    for (const stem of estimates) stem[i] = (stem[i]! ** 2 + 2.5e-11) / total;
  }
}

/** Core frames are owned by exactly one model chunk; Hann windows overlap across chunk edges. */
export function addMaskedChunk(
  chunk: SpectralChunk,
  mask: Float32Array,
  output: [Float32Array, Float32Array],
  coreStart: number,
  coreEnd: number,
): void {
  const real = new Float64Array(FFT_SIZE);
  const imaginary = new Float64Array(FFT_SIZE);
  for (let channel = 0; channel < 2; channel++) {
    const destination = output[channel]!;
    for (let frame = coreStart; frame < coreEnd; frame++) {
      const modelOffset = (channel * MODEL_FRAMES + frame) * MODEL_BINS;
      const spectrumOffset = (channel * MODEL_FRAMES + frame) * SPECTRUM_BINS;
      let average = 0;
      for (let bin = 0; bin < MODEL_BINS; bin++) average += mask[modelOffset + bin]!;
      average /= MODEL_BINS;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        const gain = bin < MODEL_BINS ? mask[modelOffset + bin]! : average;
        real[bin] = chunk.real[spectrumOffset + bin]! * gain;
        imaginary[bin] = chunk.imaginary[spectrumOffset + bin]! * gain;
      }
      for (let bin = 1; bin < FFT_SIZE / 2; bin++) {
        real[FFT_SIZE - bin] = real[bin]!;
        imaginary[FFT_SIZE - bin] = -imaginary[bin]!;
      }
      fft(real, imaginary, true);
      const start = (chunk.firstFrame + frame) * HOP_SIZE - FRONT_PAD;
      const lo = Math.max(0, -start);
      const hi = Math.min(FFT_SIZE, destination.length - start);
      for (let i = lo; i < hi; i++) {
        // Four periodic Hann windows at hop N/4 have a squared sum of exactly 1.5.
        destination[start + i] = destination[start + i]! + real[i]! * window[i]! / 1.5;
      }
    }
  }
}
