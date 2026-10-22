import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STRETCH_MAX_TEMPO, STRETCH_MIN_TEMPO } from './stretch-deck';
import { VideoDeck, clampTempo, clampTime, isUsableDuration, mediaErrorMessage } from './video-deck';

describe('clampTempo', () => {
  it('keeps rates inside the key-locked range', () => {
    expect(clampTempo(0.75)).toBe(0.75);
    expect(clampTempo(1)).toBe(1);
    expect(clampTempo(STRETCH_MIN_TEMPO)).toBe(STRETCH_MIN_TEMPO);
    expect(clampTempo(STRETCH_MAX_TEMPO)).toBe(STRETCH_MAX_TEMPO);
  });
  it('clamps rates outside it', () => {
    expect(clampTempo(0.1)).toBe(STRETCH_MIN_TEMPO);
    expect(clampTempo(-2)).toBe(STRETCH_MIN_TEMPO);
    expect(clampTempo(4)).toBe(STRETCH_MAX_TEMPO);
  });
  it('ignores non-finite rates', () => {
    expect(clampTempo(NaN)).toBeNull();
    expect(clampTempo(Infinity)).toBeNull();
    expect(clampTempo(-Infinity)).toBeNull();
  });
});

describe('clampTime', () => {
  it('clamps to [0, duration] and maps non-finite to 0', () => {
    expect(clampTime(30, 60)).toBe(30);
    expect(clampTime(-1, 60)).toBe(0);
    expect(clampTime(61, 60)).toBe(60);
    expect(clampTime(NaN, 60)).toBe(0);
    expect(clampTime(Infinity, 60)).toBe(0);
  });
});

describe('isUsableDuration', () => {
  it('accepts finite positive durations only', () => {
    expect(isUsableDuration(60)).toBe(true);
    expect(isUsableDuration(0.5)).toBe(true);
    expect(isUsableDuration(0)).toBe(false);
    expect(isUsableDuration(-1)).toBe(false);
    expect(isUsableDuration(NaN)).toBe(false);
    expect(isUsableDuration(Infinity)).toBe(false);
  });
});

describe('mediaErrorMessage', () => {
  it('names the file and the cause for each MediaError code', () => {
    expect(mediaErrorMessage(1, 'a.mp4')).toMatch(/a\.mp4.*interrupted/);
    expect(mediaErrorMessage(2, 'a.mp4')).toMatch(/a\.mp4.*could not be read/);
    expect(mediaErrorMessage(3, 'a.mp4')).toMatch(/a\.mp4.*decoded/);
    expect(mediaErrorMessage(4, 'a.mp4')).toMatch(/can't play “a\.mp4”/);
  });
  it('falls back to a generic message', () => {
    expect(mediaErrorMessage(undefined, 'a.mov')).toBe('“a.mov” could not be opened.');
    expect(mediaErrorMessage(99, 'a.mov')).toBe('“a.mov” could not be opened.');
  });
});

// ---- VideoDeck against a minimal fake <video> (Vitest runs in node: no DOM media) ------------

/** Just enough of HTMLVideoElement for VideoDeck; events are dispatched as queued tasks, like a browser. */
class FakeVideo extends EventTarget {
  paused = true;
  ended = false;
  readyState = 0;
  videoWidth = 0;
  videoHeight = 0;
  currentTime = 0;
  duration = NaN;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  webkitPreservesPitch = false;
  playsInline = false;
  preload = '';
  controls = true;
  disableRemotePlayback = false;
  muted = true;
  error: { code: number } | null = null;
  /** What play() does: start, or refuse like an autoplay block. */
  allowPlay = true;
  private readonly attrs = new Map<string, string>();

  get src(): string {
    return this.attrs.get('src') ?? '';
  }
  set src(value: string) {
    this.attrs.set('src', value);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  load(): void {
    this.paused = true;
    this.currentTime = 0;
    this.duration = NaN;
    this.error = null;
    this.playbackRate = this.defaultPlaybackRate;
  }
  play(): Promise<void> {
    if (!this.allowPlay) return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
    if (this.paused) {
      this.paused = false;
      this.queue('play');
    }
    return Promise.resolve();
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.queue('pause');
  }
  remove(): void {}
  requestVideoFrameCallback(): number {
    return 1;
  }
  cancelVideoFrameCallback(): void {}
  fire(type: string): void {
    this.dispatchEvent(new Event(type));
  }
  private queue(type: string): void {
    setTimeout(() => this.fire(type), 0);
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('VideoDeck', () => {
  let video: FakeVideo;
  let deck: VideoDeck;
  let events: string[];

  /** Loads a `duration`-second file, completing the fake's metadata load. */
  async function loadVideo(duration = 60, name = 'dance.mp4'): Promise<void> {
    const loaded = deck.load(new Blob(['x']), name);
    video.duration = duration;
    video.fire('loadedmetadata');
    await loaded;
  }

  beforeEach(() => {
    video = new FakeVideo();
    vi.stubGlobal('document', { createElement: () => video });
    deck = new VideoDeck();
    events = [];
    deck.onPlayingChange = (p) => events.push(p ? 'playing' : 'paused');
    deck.onEnded = () => events.push('ended');
  });

  afterEach(() => {
    deck.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sets the element up as an inline, unmuted, key-locked player', () => {
    expect(deck.kind).toBe('video');
    expect(deck.element).toBe(video);
    expect(video.playsInline).toBe(true);
    expect(video.preload).toBe('auto');
    expect(video.controls).toBe(false);
    expect(video.disableRemotePlayback).toBe(true);
    expect(video.muted).toBe(false);
    expect(video.preservesPitch).toBe(true);
    expect(video.webkitPreservesPitch).toBe(true);
  });

  it('loads: resolves with the duration from metadata, at 0, paused', async () => {
    const positions: number[] = [];
    deck.onPosition = (s) => positions.push(s);
    await loadVideo(60);
    expect(deck.track).toEqual({ name: 'dance.mp4', duration: 60 });
    expect(video.src.startsWith('blob:')).toBe(true);
    expect(deck.playing).toBe(false);
    expect(deck.position).toBe(0);
    expect(positions).toEqual([0]);
  });

  it('makes a 31-second video playable at metadata even when iOS defers its first frame', async () => {
    const play = vi.spyOn(video, 'play');
    const file = new Blob(['video']);
    const read = vi.spyOn(file, 'arrayBuffer');
    const loaded = deck.load(file, 'portrait-4k.mp4');
    video.duration = 31;
    video.readyState = 1;
    video.fire('loadedmetadata');
    await loaded;
    expect(deck.track?.duration).toBe(31);
    expect(video.videoWidth).toBe(0);
    expect(play).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    deck.play(); // the user gesture, without waiting indefinitely for loadeddata
    expect(play).toHaveBeenCalledOnce();
  });

  it('rejects a file the browser cannot play with a readable message and drops it', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const loaded = deck.load(new Blob(['x']), 'clip.mkv');
    video.error = { code: 4 };
    video.fire('error');
    await expect(loaded).rejects.toThrow(/can't play “clip\.mkv”/);
    expect(deck.track).toBeNull();
    expect(video.hasAttribute('src')).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('settles a superseded load quietly; the newer one wins', async () => {
    const first = deck.load(new Blob(['a']), 'first.mp4');
    const second = deck.load(new Blob(['b']), 'second.mp4');
    await expect(first).resolves.toBeUndefined();
    video.duration = 30;
    video.fire('loadedmetadata');
    await second;
    expect(deck.track).toEqual({ name: 'second.mp4', duration: 30 });
  });

  it('works out the length of a file whose header has none (MediaRecorder WebM)', async () => {
    const loaded = deck.load(new Blob(['x']), 'rec.webm');
    video.duration = Infinity;
    video.fire('loadedmetadata');
    expect(video.currentTime).toBeGreaterThan(1e6); // probing the end
    video.duration = 12.5;
    video.fire('durationchange');
    await loaded;
    expect(deck.track?.duration).toBe(12.5);
    expect(video.currentTime).toBe(0);
  });

  it('key-locks tempo on the element and keeps it across loads', async () => {
    deck.setTempo(0.75);
    expect(deck.tempo).toBe(0.75);
    expect(video.playbackRate).toBe(0.75);
    expect(video.defaultPlaybackRate).toBe(0.75);
    expect(video.preservesPitch).toBe(true);
    deck.setTempo(3);
    expect(deck.tempo).toBe(STRETCH_MAX_TEMPO);
    deck.setTempo(NaN);
    expect(deck.tempo).toBe(STRETCH_MAX_TEMPO);
    await loadVideo();
    expect(video.playbackRate).toBe(STRETCH_MAX_TEMPO);
  });

  it('reports play and an OS-initiated pause through onPlayingChange', async () => {
    await loadVideo();
    deck.play();
    expect(deck.playing).toBe(true);
    await tick();
    video.pause(); // e.g. iOS pausing the video when the screen locks
    await tick();
    expect(deck.playing).toBe(false);
    expect(events).toEqual(['playing', 'paused']);
  });

  it('turns playing back off when play() is refused', async () => {
    await loadVideo();
    video.allowPlay = false;
    deck.play();
    expect(deck.playing).toBe(true);
    await tick();
    expect(deck.playing).toBe(false);
    expect(events).toEqual(['playing', 'paused']);
  });

  it('does not get stuck showing Pause when native play throws synchronously', async () => {
    await loadVideo();
    vi.spyOn(video, 'play').mockImplementation(() => {
      throw new DOMException('decoder unavailable', 'NotSupportedError');
    });
    deck.play();
    expect(deck.playing).toBe(false);
    expect(events).toEqual([]);
  });

  it('replays from zero after reaching the end', async () => {
    await loadVideo(31);
    video.currentTime = 31;
    video.ended = true;
    const play = vi.spyOn(video, 'play');
    deck.play();
    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalledOnce();
    expect(deck.playing).toBe(true);
  });

  it('ignores an old rejected play promise after another file has replaced it', async () => {
    await loadVideo(31, 'first.mp4');
    let rejectPlay: ((reason: Error) => void) | undefined;
    const pending = new Promise<void>((_resolve, reject) => { rejectPlay = reject; });
    vi.spyOn(video, 'play').mockReturnValueOnce(pending);
    deck.play();
    await loadVideo(31, 'second.mp4');
    deck.play();
    video.paused = true; // newer playback is still awaiting the browser; an old rejection must not change it
    rejectPlay?.(new DOMException('replaced', 'AbortError'));
    await Promise.resolve();
    expect(deck.track?.name).toBe('second.mp4');
    expect(deck.playing).toBe(true);
  });

  it('reports a decoder error that happens after metadata has loaded', async () => {
    await loadVideo(31);
    deck.play();
    video.error = { code: 3 };
    video.fire('error');
    expect(deck.playing).toBe(false);
    expect(events).toEqual(['playing', 'paused']);
    expect(mediaErrorMessage(video.error.code, 'clip.mp4')).toContain('1080p MP4 with H.264');
  });

  it('ignores a queued play event that a pause() overtook', async () => {
    await loadVideo();
    deck.play();
    deck.pause();
    await tick();
    expect(deck.playing).toBe(false);
    expect(events).toEqual(['playing', 'paused']);
  });

  it('seeks clamped, keeps the play state, and jumpTo plays', async () => {
    await loadVideo(60);
    deck.seek(30);
    expect(deck.position).toBe(30);
    deck.seek(99);
    expect(deck.position).toBe(60);
    expect(deck.playing).toBe(false);
    deck.jumpTo(10);
    expect(deck.position).toBe(10);
    expect(deck.playing).toBe(true);
  });

  it('at the end: paused first, then onEnded, at the duration', async () => {
    await loadVideo(60);
    deck.play();
    await tick();
    video.currentTime = 60;
    video.paused = true;
    video.ended = true;
    video.fire('pause');
    video.fire('ended');
    expect(events).toEqual(['playing', 'paused', 'ended']);
    expect(deck.position).toBe(60);
  });

  it('ignores an ended event queued before a section repeat restarted playback', async () => {
    await loadVideo(31);
    deck.jumpTo(30);
    await tick();
    let passes = 1;
    deck.onPosition = (position) => {
      if (position !== 31 || passes >= 3) return;
      passes++;
      // A native seek away from the end clears ended, before the queued ended event is delivered.
      video.ended = false;
      deck.jumpTo(30);
    };
    for (let pass = 1; pass <= 3; pass++) {
      video.currentTime = 31;
      video.paused = true;
      video.ended = true;
      video.fire('pause'); // final position report restarts passes two and three synchronously
      video.fire('ended');
      await tick();
      expect(deck.playing).toBe(pass < 3);
      expect(deck.position).toBe(pass < 3 ? 30 : 31);
    }
    expect(passes).toBe(3);
    expect(events.filter((event) => event === 'ended')).toHaveLength(1);
  });

  it('unload pauses, clears the source and revokes its URL', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await loadVideo();
    deck.play();
    deck.unload();
    expect(deck.track).toBeNull();
    expect(deck.playing).toBe(false);
    expect(deck.position).toBe(0);
    expect(video.hasAttribute('src')).toBe(false);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['playing', 'paused']);
  });
});
