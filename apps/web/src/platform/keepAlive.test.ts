import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeepAlive, makeSilentWav, silentTrackPlan, type AudioContextLike } from './keepAlive';

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** A stand-in <audio>: records seeks, and play()/pause() flip `paused` like the real one. */
function fakeAudio(playResult: () => Promise<void> = () => Promise.resolve()) {
  const seeks: number[] = [];
  let time = 0;
  const el = {
    loop: false,
    preload: '',
    hidden: false,
    src: '',
    paused: true,
    playbackRate: 1,
    defaultPlaybackRate: 1,
    get currentTime() {
      return time;
    },
    set currentTime(t: number) {
      seeks.push(t);
      time = t;
    },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    load: vi.fn(),
    remove: vi.fn(),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    play: vi.fn(() => {
      el.paused = false;
      return playResult();
    }),
  };
  return { el, seeks };
}

/** A stand-in AudioContext whose state can be changed from the test. */
function fakeContext(state = 'suspended') {
  const listeners = new Set<() => void>();
  return {
    state,
    listeners,
    addEventListener: (_type: 'statechange', l: () => void) => void listeners.add(l),
    removeEventListener: (_type: 'statechange', l: () => void) => void listeners.delete(l),
    set(next: string) {
      this.state = next;
      for (const l of listeners) l();
    },
  };
}

/** Seconds of audio in a generated WAV (data bytes / byte rate). */
async function wavSeconds(blob: Blob): Promise<number> {
  const view = new DataView(await blob.arrayBuffer());
  return view.getUint32(40, true) / view.getUint32(28, true);
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

describe('silentTrackPlan', () => {
  it('loops 10 s without a song', () => {
    expect(silentTrackPlan(null)).toEqual({ seconds: 10, loop: true });
    expect(silentTrackPlan(NaN)).toEqual({ seconds: 10, loop: true });
    expect(silentTrackPlan(0)).toEqual({ seconds: 10, loop: true });
  });

  it('outlasts the song by a second and does not loop', () => {
    expect(silentTrackPlan(180.2)).toEqual({ seconds: 182, loop: false });
    expect(silentTrackPlan(240)).toEqual({ seconds: 241, loop: false });
  });

  it('stays over the 5 s Chrome needs for its media notification', () => {
    expect(silentTrackPlan(2)).toEqual({ seconds: 10, loop: false });
  });

  it('caps the file (and memory) for very long songs, looping it', () => {
    expect(silentTrackPlan(25 * 60)).toEqual({ seconds: 20 * 60, loop: true });
  });
});

describe('createKeepAlive', () => {
  let blobs: Blob[];
  let revoked: string[];

  beforeEach(() => {
    blobs = [];
    revoked = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) blobs.push(blob);
      return `blob:keep-alive-${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u) => void revoked.push(u));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubDom(el: unknown, visibilityState = 'visible', webkit = true) {
    vi.stubGlobal('document', { createElement: () => el, body: { appendChild: vi.fn() }, visibilityState });
    vi.stubGlobal('navigator', webkit ? { audioSession: { type: 'playback' } } : {});
  }

  it('loops a silent WAV longer than the 5 s Chrome needs for its media notification', async () => {
    const { el } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    await keepAlive.start();
    expect(el.play).toHaveBeenCalledOnce();
    expect(el.loop).toBe(true);
    expect(blobs).toHaveLength(1);
    expect(await wavSeconds(blobs[0]!)).toBeGreaterThan(5);
    keepAlive.dispose();
  });

  it('builds a non-looping file as long as the song outside the tap, then plays it', async () => {
    const { el } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    keepAlive.setTrack(95.5);
    expect(el.play).not.toHaveBeenCalled();
    expect(el.loop).toBe(false);
    expect(el.src).toBe('blob:keep-alive-1');
    expect(await wavSeconds(blobs[0]!)).toBe(97);
    expect(blobs[0]!.size).toBe(44 + 97 * 8000 * 2);
    await keepAlive.start();
    expect(el.play).toHaveBeenCalledOnce();
    expect(blobs).toHaveLength(1); // nothing generated inside the tap
    keepAlive.dispose();
    expect(revoked).toEqual(['blob:keep-alive-1']);
  });

  it('swaps files per song, frees the old one, and goes back to the short loop on unload', async () => {
    const { el } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    keepAlive.setTrack(60);
    await keepAlive.start();
    keepAlive.setTrack(120);
    expect(el.pause).toHaveBeenCalled();
    expect(el.paused).toBe(true);
    expect(el.src).toBe('blob:keep-alive-2');
    expect(revoked).toEqual(['blob:keep-alive-1']);
    keepAlive.setTrack(119.5); // same file length (121 s): nothing rebuilt
    expect(blobs).toHaveLength(2);
    keepAlive.setTrack(null);
    expect(el.loop).toBe(true);
    expect(await wavSeconds(blobs[2]!)).toBe(10);
    expect(revoked).toEqual(['blob:keep-alive-1', 'blob:keep-alive-2']);
    keepAlive.dispose();
  });

  it('follows the song clock: rate always, position only when off by more than 0.25 s', () => {
    const { el, seeks } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    keepAlive.sync(42, 0.9); // before the element exists: remembered
    keepAlive.setTrack(200); // a new song starts at 0
    expect(el.playbackRate).toBe(0.9);
    expect(el.defaultPlaybackRate).toBe(0.9);
    keepAlive.sync(42, 0.9);
    expect(seeks).toEqual([42]);
    keepAlive.sync(42.2, 0.9); // within tolerance
    expect(seeks).toEqual([42]);
    keepAlive.sync(10, 1.1);
    expect(seeks).toEqual([42, 10]);
    expect(el.playbackRate).toBe(1.1);
    keepAlive.sync(500, 9); // past the file: clamped inside it; absurd rate clamped
    expect(seeks.at(-1)).toBe(200.5);
    expect(el.playbackRate).toBe(4);
    keepAlive.sync(NaN, -1); // ignored
    expect(seeks).toHaveLength(3);
    expect(el.playbackRate).toBe(4);
    keepAlive.dispose();
  });

  it('never seeks a looping file (no song, or one longer than the cap)', () => {
    const { el, seeks } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    keepAlive.setTrack(30 * 60);
    keepAlive.sync(900, 1);
    keepAlive.setTrack(null);
    keepAlive.sync(5, 1);
    expect(seeks).toEqual([]);
    keepAlive.dispose();
  });

  it('starts at the song position', async () => {
    const { el, seeks } = fakeAudio();
    stubDom(el);
    const keepAlive = createKeepAlive();
    keepAlive.setTrack(100);
    keepAlive.stop();
    keepAlive.sync(33, 1);
    await keepAlive.start();
    expect(seeks).toEqual([33]);
    expect(el.play).toHaveBeenCalledOnce();
    keepAlive.dispose();
  });

  it('claims the current media session again with pause + play while playing', async () => {
    const { el } = fakeAudio();
    stubDom(el);
    const onStarted = vi.fn();
    const keepAlive = createKeepAlive({ onStarted });
    keepAlive.claim(); // nothing built yet
    keepAlive.setTrack(100);
    keepAlive.claim(); // not playing
    expect(el.play).not.toHaveBeenCalled();
    await keepAlive.start();
    expect(onStarted).toHaveBeenCalledOnce();
    keepAlive.claim();
    expect(el.pause.mock.invocationCallOrder.at(-1)!).toBeLessThan(el.play.mock.invocationCallOrder.at(-1)!);
    expect(el.play).toHaveBeenCalledTimes(2);
    expect(el.paused).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(onStarted).toHaveBeenCalledTimes(2);
    keepAlive.dispose();
  });

  it('does not claim where it could hurt: hidden page, or not WebKit', async () => {
    const hidden = fakeAudio();
    stubDom(hidden.el, 'hidden');
    const a = createKeepAlive();
    await a.start();
    a.claim();
    expect(hidden.el.play).toHaveBeenCalledOnce();
    a.dispose();

    const chrome = fakeAudio();
    stubDom(chrome.el, 'visible', false);
    const b = createKeepAlive();
    await b.start();
    b.claim();
    expect(chrome.el.play).toHaveBeenCalledOnce();
    b.dispose();
  });

  it('claims when the AudioContext starts running after it, and stops listening on dispose', async () => {
    const { el } = fakeAudio();
    stubDom(el);
    const ctx = fakeContext('suspended');
    const keepAlive = createKeepAlive({ context: ctx });
    keepAlive.setTrack(100);
    expect(ctx.listeners.size).toBe(1);
    ctx.set('running'); // not playing yet: nothing to claim
    expect(el.play).not.toHaveBeenCalled();
    await keepAlive.start();
    ctx.set('interrupted');
    expect(el.play).toHaveBeenCalledOnce();
    ctx.set('running');
    expect(el.play).toHaveBeenCalledTimes(2);
    keepAlive.dispose();
    expect(ctx.listeners.size).toBe(0);
  });

  it('accepts a real AudioContext', () => {
    const accept = (ctx: AudioContext): AudioContextLike => ctx;
    expect(typeof accept).toBe('function');
  });

  it('reports a refused start as not started', async () => {
    const refusal = Object.assign(new Error('needs a tap'), { name: 'NotAllowedError' });
    const { el } = fakeAudio(() => Promise.reject(refusal));
    stubDom(el);
    const onStarted = vi.fn();
    const keepAlive = createKeepAlive({ onStarted });
    await expect(keepAlive.start()).resolves.toBeUndefined();
    expect(onStarted).not.toHaveBeenCalled();
    keepAlive.dispose();
  });

  it('is a no-op without a DOM', async () => {
    vi.stubGlobal('document', undefined);
    const keepAlive = createKeepAlive();
    await expect(keepAlive.start()).resolves.toBeUndefined();
    expect(() => {
      keepAlive.setTrack(100);
      keepAlive.sync(3, 1);
      keepAlive.claim();
      keepAlive.stop();
      keepAlive.dispose();
    }).not.toThrow();
  });
});
