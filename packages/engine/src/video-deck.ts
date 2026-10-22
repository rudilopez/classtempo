import type { LoadedTrack } from './deck';
import type { DancerPlayer } from './dancer-player';
import { STRETCH_MAX_TEMPO, STRETCH_MIN_TEMPO } from './stretch-deck';

/**
 * Target gap between position reports while playing, ms (20/s). Ticks come once per video or display frame, so
 * a tick within half a frame of the target reports too: 60 Hz and 120 Hz displays land on exactly 20/s, and a
 * 30 fps video at 0.75× (a frame every ~44 ms) reports every frame rather than every other one.
 */
const REPORT_INTERVAL_MS = 50;
/**
 * No video frame callback for this long while playing means they are not coming: the element is not rendered
 * (detached, `display: none`, page hidden) or the picture is a still. Reporting then falls back to animation
 * frames (and `timeupdate`) until the next play.
 */
const FRAME_STARVED_MS = 300;
/** A load that has neither metadata nor an error by then fails instead of hanging. */
const LOAD_TIMEOUT_MS = 20_000;
/**
 * Media fragment that makes iOS Safari seek during the load and so show the first frame before playback (it
 * otherwise stays black until play). Playback starts 1 ms in; seeks and replays go to 0 as usual.
 */
const FIRST_FRAME_FRAGMENT = '#t=0.001';

/** Tempo for a requested rate: clamped to the key-locked range, or null for a non-finite rate (ignored). */
export function clampTempo(rate: number): number | null {
  if (!Number.isFinite(rate)) return null;
  return Math.max(STRETCH_MIN_TEMPO, Math.min(STRETCH_MAX_TEMPO, rate));
}

/** Seconds clamped to [0, duration]; non-finite → 0. */
export function clampTime(seconds: number, duration: number): number {
  return Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, duration)) : 0;
}

/** A media duration a track can have: finite and positive (not NaN, Infinity or 0). */
export function isUsableDuration(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0;
}

/** Readable message for a failed load, from `MediaError.code` (undefined when the element gave none). */
export function mediaErrorMessage(code: number | undefined, name: string): string {
  switch (code) {
    case 1: // MEDIA_ERR_ABORTED
      return `Loading “${name}” was interrupted.`;
    case 2: // MEDIA_ERR_NETWORK
      return `“${name}” could not be read.`;
    case 3: // MEDIA_ERR_DECODE
      return `“${name}” could not be decoded — the file may be damaged.`;
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return `This browser can't play “${name}”. Try an MP4 (H.264) video.`;
    default:
      return `“${name}” could not be opened.`;
  }
}

/** Vendor-prefixed pitch preservation, present on older Safari (webkit) and Firefox (moz). */
type PitchPreservingMedia = HTMLMediaElement & {
  webkitPreservesPitch?: boolean;
  mozPreservesPitch?: boolean;
};

/** Key lock: sets `rate` on `el` with pitch preserved (unprefixed and every vendor prefix present). */
function applyRate(el: PitchPreservingMedia, rate: number): void {
  el.preservesPitch = true;
  if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = true;
  if ('mozPreservesPitch' in el) el.mozPreservesPitch = true;
  // The load algorithm resets playbackRate to defaultPlaybackRate, so set both.
  if (el.defaultPlaybackRate !== rate) el.defaultPlaybackRate = rate;
  if (el.playbackRate !== rate) el.playbackRate = rate;
}

/**
 * Key-locked video player for Dancer mode. The `<video>` element is both the picture and the sound: it plays
 * straight from the file (object URL), so a phone video of hundreds of MB is never decoded into memory, and
 * tempo uses the browser's own pitch-preserving time-stretch (`preservesPitch`). The element is not muted and
 * not connected to the engine's AudioContext. Mount `element` wherever the picture should show; it plays the
 * same detached or hidden.
 *
 * The element's own events keep `playing` true to it, so pauses the OS makes (iOS pauses video when the screen
 * locks or native full screen closes, an interruption, a refused play) reach `onPlayingChange`. All public
 * times are seconds in track time.
 */
export class VideoDeck implements DancerPlayer {
  readonly kind = 'video' as const;
  readonly element: HTMLVideoElement;

  /** ≈20×/s while playing (video or animation frames, plus `timeupdate`), and on seek / pause / end. */
  onPosition: ((seconds: number) => void) | null = null;
  /** Once when playback reaches the end; the deck is then paused at `duration`. */
  onEnded: (() => void) | null = null;
  /** On every play/pause transition, including OS-initiated ones; before `onEnded` at the end of the track. */
  onPlayingChange: ((playing: boolean) => void) | null = null;

  private _track: LoadedTrack | null = null;
  private _playing = false;
  private _tempo = 1;
  private url: string | null = null;
  private loadSeq = 0;
  /** Settles the in-flight load quietly when a newer load / unload supersedes it. */
  private cancelLoad: (() => void) | null = null;
  private frameHandle: number | null = null;
  private frameKind: 'video' | 'animation' = 'animation';
  /** Set when video frame callbacks starve during this playback; cleared on the next play. */
  private framesStarved = false;
  private lastFrameAt = 0;
  private lastReportAt = -Infinity;
  private readonly listeners: [string, EventListener][];
  private disposed = false;

  constructor() {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.controls = false;
    v.disableRemotePlayback = true;
    v.muted = false;
    applyRate(v, 1);
    this.element = v;

    const sync = (): void => this.syncPlaying();
    this.listeners = [
      ['play', sync],
      ['pause', sync],
      ['webkitendfullscreen', sync], // iOS: leaving native full screen pauses the video
      ['ended', () => this.handleEnded()],
      ['seeked', () => this.report(true)],
      ['timeupdate', () => this.handleTimeUpdate()],
      ['error', () => this.handleError()],
    ];
    for (const [type, fn] of this.listeners) v.addEventListener(type, fn);
  }

  // ---- track -------------------------------------------------------------------------------

  get track(): LoadedTrack | null {
    return this._track;
  }

  /**
   * Opens `file` (paused, at 0, tempo kept). Resolves once its metadata is in with a usable duration, rejects
   * with a readable message when the browser cannot play it; a load superseded by a newer `load` / `unload`
   * resolves without a track. Revokes the previous file's object URL.
   */
  load(file: Blob, name: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('VideoDeck is disposed'));
    this.cancelLoad?.();
    const seq = ++this.loadSeq;
    const v = this.element;
    this._track = null;
    if (!v.paused) v.pause();
    this.setPlaying(false);
    this.revokeUrl();
    const url = URL.createObjectURL(file);
    this.url = url;

    return new Promise<void>((resolve, reject) => {
      /** Probing for the real duration of a file whose header has none (MediaRecorder WebM reports Infinity). */
      let probing = false;
      const done = (): void => {
        clearTimeout(timer);
        for (const [type, fn] of handlers) v.removeEventListener(type, fn);
        if (this.cancelLoad === cancel) this.cancelLoad = null;
      };
      const cancel = (): void => {
        done();
        resolve();
      };
      const fail = (message: string): void => {
        done();
        if (seq === this.loadSeq) this.clearSource();
        reject(new Error(message));
      };
      const finish = (duration: number): void => {
        done();
        if (probing) v.currentTime = 0;
        applyRate(v, this._tempo);
        this._track = { name, duration };
        this.onPosition?.(0);
        resolve();
      };
      const onMetadata = (): void => {
        if (isUsableDuration(v.duration)) finish(v.duration);
        else if (v.duration === Infinity) {
          probing = true;
          v.currentTime = Number.MAX_SAFE_INTEGER; // reading to the end makes the browser work the duration out
        } else fail(`“${name}” has no playable length.`);
      };
      const onProbe = (): void => {
        if (probing && isUsableDuration(v.duration)) finish(v.duration);
      };
      const onError = (): void => fail(mediaErrorMessage(v.error?.code, name));
      const handlers: [string, EventListener][] = [
        ['loadedmetadata', onMetadata],
        ['durationchange', onProbe],
        ['timeupdate', onProbe],
        ['seeked', onProbe],
        ['error', onError],
      ];
      const timer = setTimeout(() => fail(`“${name}” took too long to open.`), LOAD_TIMEOUT_MS);
      for (const [type, fn] of handlers) v.addEventListener(type, fn);
      this.cancelLoad = cancel;
      v.src = url + FIRST_FRAME_FRAGMENT;
      v.load(); // explicit, for iOS Safari, which may otherwise wait for a play before reading metadata
    });
  }

  /** Pauses, removes the source and revokes its object URL; tempo is kept. */
  unload(): void {
    this.cancelLoad?.();
    this.loadSeq++;
    this._track = null;
    const v = this.element;
    if (!v.paused) v.pause();
    this.setPlaying(false);
    this.clearSource();
  }

  /** Teardown: unloads, clears the callbacks, drops the listeners and takes the element out of the page. */
  dispose(): void {
    if (this.disposed) return;
    this.onPosition = null;
    this.onEnded = null;
    this.onPlayingChange = null;
    this.unload();
    for (const [type, fn] of this.listeners) this.element.removeEventListener(type, fn);
    this.element.remove();
    this.disposed = true;
  }

  // ---- transport ---------------------------------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  /** Seconds, clamped to [0, duration]; the element's current playback position. */
  get position(): number {
    const track = this._track;
    return track ? clampTime(this.element.currentTime, track.duration) : 0;
  }

  /**
   * Resumes; from the end the element restarts at 0. Calls `element.play()` synchronously, so call it inside a
   * user gesture or a Media Session handler. `playing` turns true at once; a refused play (NotAllowedError,
   * e.g. outside a gesture or with the screen locked) is swallowed and turns it back off via `onPlayingChange`.
   */
  play(): void {
    if (!this._track || this._playing) return;
    const v = this.element;
    applyRate(v, this._tempo);
    let started: Promise<void> | undefined;
    try {
      started = v.play();
    } catch {
      // Engines from before play() returned a promise may throw synchronously instead.
    }
    this.setPlaying(true);
    this.report(true);
    started?.catch(() => {
      // NotAllowedError (no gesture / locked), AbortError (a pause or load overtook it), NotSupportedError.
      if (v.paused || v.error) this.setPlaying(false);
    });
  }

  pause(): void {
    const v = this.element;
    if (!this._playing && v.paused) return;
    v.pause();
    this.setPlaying(false);
    this.report(true);
  }

  toggle(): void {
    this._playing ? this.pause() : this.play();
  }

  /** Works playing or paused; the play state is unchanged. */
  seek(seconds: number): void {
    const track = this._track;
    if (!track) return;
    this.element.currentTime = clampTime(seconds, track.duration);
    this.report(true);
  }

  /** Seek and play — cue launch. */
  jumpTo(seconds: number): void {
    if (!this._track) return;
    this.seek(seconds);
    this.play();
  }

  // ---- tempo -------------------------------------------------------------------------------

  /** Playback-rate multiplier, 0.5..1.5, default 1. Pitch is always preserved (key lock). */
  get tempo(): number {
    return this._tempo;
  }

  /** Clamped to [0.5, 1.5]; non-finite values are ignored. */
  setTempo(rate: number): void {
    const r = clampTempo(rate);
    if (r === null) return;
    this._tempo = r;
    applyRate(this.element, r);
  }

  // ---- internals ---------------------------------------------------------------------------

  private setPlaying(playing: boolean): void {
    if (playing) {
      if (!this._playing) {
        this.framesStarved = false;
        this.lastFrameAt = performance.now();
      }
      this.requestFrame();
    } else this.cancelFrame();
    if (playing === this._playing) return;
    this._playing = playing;
    this.onPlayingChange?.(playing);
  }

  /** The element's play/pause events: whatever it says now wins (a queued 'play' may arrive after a pause()). */
  private syncPlaying(): void {
    const playing = this._track !== null && !this.element.paused;
    this.setPlaying(playing);
    if (!playing) this.report(true);
  }

  private handleEnded(): void {
    if (!this._track) return;
    this.setPlaying(false);
    this.report(true);
    this.onEnded?.();
  }

  /** A decode error mid-song stops playback (load errors are handled by `load`). */
  private handleError(): void {
    if (this._track) this.setPlaying(false);
  }

  private handleTimeUpdate(): void {
    if (!this._playing) return;
    this.report(false);
    if (
      this.frameKind === 'video' &&
      !this.framesStarved &&
      performance.now() - this.lastFrameAt > FRAME_STARVED_MS
    ) {
      this.framesStarved = true;
      this.cancelFrame();
      this.requestFrame();
    }
  }

  /**
   * Position report, at most every REPORT_INTERVAL_MS (less `slack`, up to half of it) unless `force`; only with
   * a track loaded.
   */
  private report(force: boolean, slack = 0): void {
    if (!this._track) return;
    const now = performance.now();
    const minGap = REPORT_INTERVAL_MS - Math.min(slack, REPORT_INTERVAL_MS / 2);
    if (!force && now - this.lastReportAt < minGap) return;
    this.lastReportAt = now;
    this.onPosition?.(this.position);
  }

  private readonly onFrame = (): void => {
    const now = performance.now();
    const frameGap = now - this.lastFrameAt;
    this.frameHandle = null;
    this.lastFrameAt = now;
    if (!this._playing) return;
    this.report(false, frameGap / 2);
    this.requestFrame();
  };

  /** Schedules the next report tick: a video frame callback where supported, else an animation frame. */
  private requestFrame(): void {
    if (this.frameHandle !== null) return;
    const v = this.element;
    if (!this.framesStarved && typeof v.requestVideoFrameCallback === 'function') {
      this.frameKind = 'video';
      this.frameHandle = v.requestVideoFrameCallback(this.onFrame);
    } else if (typeof requestAnimationFrame === 'function') {
      this.frameKind = 'animation';
      this.frameHandle = requestAnimationFrame(this.onFrame);
    }
  }

  private cancelFrame(): void {
    if (this.frameHandle === null) return;
    if (this.frameKind === 'video') this.element.cancelVideoFrameCallback(this.frameHandle);
    else cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  /** Detaches the source so the element lets go of the file, then revokes its URL. */
  private clearSource(): void {
    const v = this.element;
    if (v.hasAttribute('src')) {
      v.removeAttribute('src');
      v.load(); // with no source this just empties the element: no error, no network
    }
    this.revokeUrl();
  }

  private revokeUrl(): void {
    if (this.url === null) return;
    URL.revokeObjectURL(this.url);
    this.url = null;
  }
}
