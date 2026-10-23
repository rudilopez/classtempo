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
  networkState = 0;
  seeking = false;
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
  error: { code: number; message?: string } | null = null;
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
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
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
    expect(video.preload).toBe('metadata');
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
    expect(new URL(video.src).hash).toBe(''); // Opening must not request a preview seek/decode before Play.
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

  it('issues requested native play synchronously after source/load and after applying exercise start and tempo', async () => {
    const order: string[] = [];
    const load = video.load.bind(video);
    vi.spyOn(video, 'load').mockImplementation(() => { order.push('load'); load(); });
    const play = video.play.bind(video);
    const nativePlay = vi.spyOn(video, 'play').mockImplementation(() => {
      order.push('play');
      expect(video.src).toMatch(/^blob:/);
      expect(video.currentTime).toBe(7.5);
      expect(video.playbackRate).toBe(0.75);
      expect(video.defaultPlaybackRate).toBe(0.75);
      expect(video.preservesPitch).toBe(true);
      return play();
    });
    const element = deck.element;
    const loaded = deck.load(new Blob(['x']), 'exercise.mp4', { play: true, startTime: 7.5, tempo: 0.75 });
    order.push('returned');
    expect(order).toEqual(['load', 'play', 'returned']);
    expect(deck.track).toBeNull();
    video.duration = 31;
    video.fire('loadedmetadata');
    await loaded;
    await tick();
    expect(deck.element).toBe(element);
    expect(deck.position).toBe(7.5);
    expect(deck.tempo).toBe(0.75);
    expect(deck.playing).toBe(true);
    expect(nativePlay).toHaveBeenCalledOnce();
  });

  it('loads an explicit resume position paused and bounds it to the actual duration', async () => {
    const play = vi.spyOn(video, 'play');
    const loaded = deck.load(new Blob(['x']), 'resume.mp4', { startTime: 500, tempo: 0.1 });
    expect(video.currentTime).toBe(500);
    video.duration = 31;
    video.fire('loadedmetadata');
    await loaded;
    expect(deck.position).toBe(31);
    expect(deck.tempo).toBe(STRETCH_MIN_TEMPO);
    expect(deck.playing).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it.each(['rejection', 'throw'] as const)('keeps metadata load successful and paused after an opt-in native play %s', async (failure) => {
    if (failure === 'rejection') video.allowPlay = false;
    else vi.spyOn(video, 'play').mockImplementation(() => { throw new DOMException('blocked', 'NotAllowedError'); });
    const loaded = deck.load(new Blob(['x']), 'blocked.mp4', { play: true, startTime: 4 });
    video.duration = 31;
    video.fire('loadedmetadata');
    await expect(loaded).resolves.toBeUndefined();
    await tick();
    expect(deck.track?.duration).toBe(31);
    expect(deck.position).toBe(4);
    expect(deck.playing).toBe(false);
    expect(video.paused).toBe(true);
    expect(deck.error).toBeNull();
    expect(deck.getDiagnostics().error?.message).toContain('NotAllowedError');
    expect(events).not.toContain('playing');
  });

  it('does not revive cancelled load-and-play from late metadata, play events or a resolved play promise', async () => {
    let resolvePlay: (() => void) | undefined;
    vi.spyOn(video, 'play').mockImplementation(() => {
      video.paused = false;
      return new Promise<void>((resolve) => { resolvePlay = resolve; });
    });
    const loaded = deck.load(new Blob(['x']), 'cancelled.mp4', { play: true, startTime: 5 });
    deck.pause();
    video.paused = false; // A late native event must not defeat the explicit pause.
    video.fire('play');
    expect(video.paused).toBe(true);
    video.duration = 31;
    video.fire('loadedmetadata');
    await loaded;
    resolvePlay?.();
    await tick();
    expect(deck.position).toBe(5);
    expect(deck.playing).toBe(false);
    expect(events).not.toContain('playing');
  });

  it('ignores stale load-and-play completions after unload or a newer source starts', async () => {
    let resolvePlay: (() => void) | undefined;
    const nativePlay = video.play.bind(video);
    vi.spyOn(video, 'play').mockImplementationOnce(() => new Promise<void>((resolve) => { resolvePlay = resolve; }));
    const first = deck.load(new Blob(['a']), 'old.mp4', { play: true });
    deck.unload();
    await first;
    resolvePlay?.();
    await tick();
    expect(deck.track).toBeNull();
    expect(deck.playing).toBe(false);
    let rejectOld: ((error: Error) => void) | undefined;
    vi.spyOn(video, 'play').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    const old = deck.load(new Blob(['b']), 'older.mp4', { play: true });
    vi.spyOn(video, 'play').mockImplementation(nativePlay);
    const current = deck.load(new Blob(['c']), 'current.mp4', { play: true, startTime: 2 });
    video.duration = 31;
    video.fire('loadedmetadata');
    await Promise.all([old, current]);
    rejectOld?.(new DOMException('old request', 'AbortError'));
    await tick();
    expect(deck.track?.name).toBe('current.mp4');
    expect(deck.position).toBe(2);
    expect(deck.playing).toBe(true);
    expect(deck.getDiagnostics().events.some((event) => event.event === 'play-rejected')).toBe(false);
  });

  it('lets a later explicit Play win over a cancelled pending load-and-play on the same source', async () => {
    let resolveOldPlay: (() => void) | undefined;
    const nativePlay = video.play.bind(video);
    vi.spyOn(video, 'play').mockImplementationOnce(() => {
      video.paused = false;
      return new Promise<void>((resolve) => { resolveOldPlay = resolve; });
    });
    const loaded = deck.load(new Blob(['x']), 'same.mp4', { play: true });
    video.duration = 31;
    video.fire('loadedmetadata');
    await loaded;
    deck.pause();
    vi.spyOn(video, 'play').mockImplementation(nativePlay);
    deck.play();
    resolveOldPlay?.();
    await tick();
    expect(deck.playing).toBe(true);
    expect(video.paused).toBe(false);
  });

  it('does not retry opt-in play after probing an unknown duration or clamping its start to the end', async () => {
    const play = vi.spyOn(video, 'play');
    const loaded = deck.load(new Blob(['x']), 'probe.webm', { play: true, startTime: 4 });
    video.duration = Infinity;
    video.fire('loadedmetadata');
    expect(video.paused).toBe(true);
    video.duration = 12;
    video.fire('durationchange');
    await loaded;
    await tick();
    expect(deck.position).toBe(4);
    expect(deck.playing).toBe(false);
    expect(play).toHaveBeenCalledOnce();
    const pastEnd = deck.load(new Blob(['x']), 'end.mp4', { play: true, startTime: 100 });
    video.duration = 31;
    video.fire('loadedmetadata');
    await pastEnd;
    await tick();
    expect(deck.position).toBe(31);
    expect(deck.playing).toBe(false);
    expect(play).toHaveBeenCalledTimes(2);
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

  it('keeps a fatal decoder error paused despite late native play events and further play requests', async () => {
    await loadVideo(31);
    const play = vi.spyOn(video, 'play');
    deck.play();
    video.currentTime = 12;
    video.error = { code: 3 };
    video.fire('error');
    expect(video.paused).toBe(true);
    expect(deck.error).toContain('could not be decoded');
    // Some native event sequences expose paused=false after the error was already reported.
    video.paused = false;
    video.fire('play');
    deck.play();
    deck.jumpTo(5);
    await tick();
    expect(video.paused).toBe(true);
    expect(deck.playing).toBe(false);
    expect(deck.position).toBe(12);
    expect(play).toHaveBeenCalledOnce();
    expect(events).toEqual(['playing', 'paused']);

    await loadVideo(31, 'new-video.mp4');
    expect(deck.error).toBeNull();
    video.fire('error'); // A stale event without a current native failure must not poison the new source.
    deck.play();
    expect(deck.playing).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('does not set playing when the decoder fails synchronously inside native play', async () => {
    await loadVideo(31);
    vi.spyOn(video, 'play').mockImplementation(() => {
      video.paused = false;
      video.error = { code: 3 };
      video.fire('error');
      return Promise.resolve();
    });
    deck.play();
    await tick();
    expect(video.paused).toBe(true);
    expect(deck.playing).toBe(false);
    expect(events).toEqual([]);
    expect(deck.error).toContain('could not be decoded');
  });

  it('retains useful error diagnostics after a failed load clears the native source, without identifying it', async () => {
    const file = new Blob(['video'], { type: 'video/mp4' });
    const loaded = deck.load(file, 'private-class.m4v');
    video.error = { code: 3, message: `Cannot decode private-class.m4v at ${video.src} /Users/private/source.mov C:\\Users\\private\\source.mov` };
    video.fire('error');
    await expect(loaded).rejects.toThrow(/decoded/);
    expect(video.error).toBeNull(); // load() clears the native failure along with the source.
    const diagnostic = deck.getDiagnostics();
    expect(diagnostic.file).toEqual({ bytes: 5, type: 'video/mp4' });
    expect(diagnostic.error).toEqual({ code: 3, message: 'Cannot decode [video] at [source] [source] [source]' });
    expect(diagnostic.events.some((event) => event.event === 'error' && event.errorCode === 3)).toBe(true);
    expect(diagnostic.events.some((event) => event.event === 'load-failed')).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toMatch(/private-class|blob:|file:\/\/|https?:\/\//);

    await loadVideo(31, 'fresh.mp4');
    expect(deck.getDiagnostics().error).toBeNull();
    expect(deck.getDiagnostics().events.map((event) => event.event)).toEqual(['loadedmetadata']);
  });

  it('bounds diagnostic history, ignores frame updates, and returns copies', async () => {
    await loadVideo(31);
    const initial = deck.getDiagnostics().events;
    for (let index = 0; index < 100; index++) video.fire('timeupdate');
    expect(deck.getDiagnostics().events).toEqual(initial);
    for (let index = 0; index < 100; index++) {
      video.currentTime = index / 10;
      video.fire('seeking');
    }
    const diagnostic = deck.getDiagnostics();
    expect(diagnostic.events).toHaveLength(32);
    expect(diagnostic.events[0]?.position).toBe(6.8);
    diagnostic.events[0]!.event = 'mutated';
    diagnostic.file!.bytes = 999;
    expect(deck.getDiagnostics().events[0]?.event).toBe('seeking');
    expect(deck.getDiagnostics().file?.bytes).toBe(1);
    deck.unload();
    expect(deck.getDiagnostics().file).toBeNull();
    expect(deck.getDiagnostics().events).toEqual([]);
  });

  it('records a rejected native Play without treating a gesture refusal as a fatal decoder error', async () => {
    await loadVideo(31);
    video.allowPlay = false;
    deck.play();
    await tick();
    expect(deck.getDiagnostics().error?.message).toContain('NotAllowedError');
    expect(deck.getDiagnostics().events.some((event) => event.event === 'play-rejected')).toBe(true);
    expect(deck.error).toBeNull();
    video.allowPlay = true;
    deck.play();
    expect(deck.playing).toBe(true);
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
