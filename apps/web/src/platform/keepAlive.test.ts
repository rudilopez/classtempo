import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeepAlive, makeSilentWav } from './keepAlive';

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe('makeSilentWav', () => {
  it('writes a 16-bit PCM mono RIFF/WAVE header', () => {
    const wav = makeSilentWav(1, 22050);
    const view = new DataView(wav.buffer);
    expect(wav.length).toBe(44 + 22050 * 2);
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(text(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(28, true)).toBe(44100);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(22050 * 2);
  });

  it('is silent', () => {
    expect(makeSilentWav(0.5, 8000).subarray(44).every((b) => b === 0)).toBe(true);
  });

  it('rounds the frame count and tolerates bad durations', () => {
    expect(makeSilentWav(0.0001, 22050).length).toBe(44 + 2 * 2);
    expect(makeSilentWav(0, 22050).length).toBe(44);
    expect(makeSilentWav(-1, 22050).length).toBe(44);
    expect(makeSilentWav(NaN, 22050).length).toBe(44);
  });
});

describe('createKeepAlive', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loops a silent WAV longer than the 5 s Chrome needs for its media notification', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);
      return 'blob:keep-alive';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const el = {
      loop: false,
      preload: '',
      hidden: false,
      src: '',
      paused: true,
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      remove: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
    };
    vi.stubGlobal('document', { createElement: () => el, body: { appendChild: vi.fn() } });

    const keepAlive = createKeepAlive();
    await keepAlive.start();
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.loop).toBe(true);
    expect(blobs).toHaveLength(1);
    const wav = new Uint8Array(await blobs[0]!.arrayBuffer());
    const view = new DataView(wav.buffer);
    const seconds = view.getUint32(40, true) / view.getUint32(28, true); // data bytes / byte rate
    expect(seconds).toBeGreaterThan(5);
    keepAlive.dispose();
  });

  it('is a no-op without a DOM', async () => {
    vi.stubGlobal('document', undefined);
    const keepAlive = createKeepAlive();
    await expect(keepAlive.start()).resolves.toBeUndefined();
    expect(() => keepAlive.stop()).not.toThrow();
    expect(() => keepAlive.dispose()).not.toThrow();
  });
});
