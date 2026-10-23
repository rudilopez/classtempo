/** Stereo pairs are vocals, drums, bass, other; each pair is left then right. */
export const STEM_CHANNEL_COUNT = 8;
export const MAX_PCM_SCALE = 3.4028234663852886e38;

export function stemPcmBytes(frameCount: number): number {
  const bytes = frameCount * STEM_CHANNEL_COUNT * 2;
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(bytes)) {
    throw new Error('Invalid stem frame count.');
  }
  return bytes;
}

export function validateStemChannels(channels: readonly Float32Array[], sampleRate: number): number {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error('Invalid stem sample rate.');
  }
  const frameCount = channels[0]?.length ?? 0;
  stemPcmBytes(frameCount);
  if (channels.length !== STEM_CHANNEL_COUNT || channels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
    throw new Error('Stems must contain four complete stereo pairs of equal length.');
  }
  return frameCount;
}

/** Preserve stem peaks above 1 instead of clipping them during int16 storage. */
export function pcmScale(samples: Float32Array): number {
  let scale = 1;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('Stems contain invalid audio samples.');
    scale = Math.max(scale, Math.abs(sample));
  }
  return scale;
}

/** Explicit little endian encoding is portable; scale belongs to the whole channel. */
export function encodePcm16(samples: Float32Array, scale = pcmScale(samples)): ArrayBuffer {
  if (!Number.isFinite(scale) || scale < 1 || scale > MAX_PCM_SCALE) throw new Error('Invalid stem amplitude scale.');
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    if (!Number.isFinite(sample) || Math.abs(sample) > scale) throw new Error('Stems contain invalid audio samples.');
    const normalized = sample / scale;
    view.setInt16(i * 2, Math.round(normalized * (normalized < 0 ? 32_768 : 32_767)), true);
  }
  return buffer;
}

export function decodePcm16(buffer: ArrayBuffer, scale: number): Float32Array {
  if (buffer.byteLength % 2 !== 0 || !Number.isFinite(scale) || scale < 1 || scale > MAX_PCM_SCALE) throw new Error('Invalid stored stem audio.');
  const view = new DataView(buffer);
  const output = new Float32Array(buffer.byteLength / 2);
  for (let i = 0; i < output.length; i++) {
    const sample = view.getInt16(i * 2, true);
    output[i] = sample / (sample < 0 ? 32_768 : 32_767) * scale;
  }
  return output;
}
