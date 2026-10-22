/** Include a final partial chunk, without re-running a redundant all-overlap tail. */
export function chunkOffsets(total: number, chunk: number, stride: number): number[] {
  if (total < 1 || chunk < 1 || stride < 1 || stride > chunk) throw new Error('Invalid chunk dimensions');
  const offsets = [0];
  while (offsets[offsets.length - 1]! + chunk < total) offsets.push(offsets[offsets.length - 1]! + stride);
  return offsets;
}

/** Positive boundary weights preserve the first and last sample after normalization. */
export function overlapWindow(size: number, overlap: number): Float32Array {
  if (size < 1 || overlap < 0 || overlap * 2 > size) throw new Error('Invalid window dimensions');
  const window = new Float32Array(size).fill(1);
  for (let i = 0; i < overlap; i++) {
    const weight = (i + 1) / (overlap + 1);
    window[i] = weight;
    window[size - 1 - i] = weight;
  }
  return window;
}

/** Bounded overlap-add: finalized samples are measured and discarded after a short listening preview. */
export class StreamingOverlapAdd {
  readonly preview: Float32Array[];
  readonly rms: number[];
  private readonly sums: Float32Array[];
  private readonly weights: Float32Array;
  private emitted = 0;
  private readonly squares: number[];

  constructor(
    private readonly channels: number,
    private readonly chunk: number,
    private readonly stride: number,
    previewSamples: number,
  ) {
    this.sums = Array.from({ length: channels }, () => new Float32Array(chunk));
    this.weights = new Float32Array(chunk);
    this.preview = Array.from({ length: channels }, () => new Float32Array(previewSamples));
    this.squares = Array.from({ length: channels }, () => 0);
    this.rms = Array.from({ length: channels }, () => 0);
  }

  add(data: Float32Array, valid: number, final: boolean, window: Float32Array): void {
    if (data.length !== this.channels * this.chunk || valid < 1 || valid > this.chunk) {
      throw new Error('Unexpected stem output dimensions');
    }
    for (let i = 0; i < valid; i++) this.weights[i] = this.weights[i]! + window[i]!;
    for (let channel = 0; channel < this.channels; channel++) {
      const sum = this.sums[channel]!;
      const base = channel * this.chunk;
      for (let i = 0; i < valid; i++) {
        const value = data[base + i]!;
        if (!Number.isFinite(value)) throw new Error('Model produced non-finite audio; this run is invalid');
        sum[i] = sum[i]! + value * window[i]!;
      }
    }
    const count = final ? valid : this.stride;
    for (let channel = 0; channel < this.channels; channel++) {
      const sum = this.sums[channel]!;
      const preview = this.preview[channel]!;
      let squares = this.squares[channel]!;
      for (let i = 0; i < count; i++) {
        const value = sum[i]! / this.weights[i]!;
        squares += value * value;
        if (this.emitted + i < preview.length) preview[this.emitted + i] = value;
      }
      this.squares[channel] = squares;
      this.rms[channel] = Math.sqrt(squares / (this.emitted + count));
      sum.copyWithin(0, count);
      sum.fill(0, this.chunk - count);
    }
    this.weights.copyWithin(0, count);
    this.weights.fill(0, this.chunk - count);
    this.emitted += count;
  }
}
