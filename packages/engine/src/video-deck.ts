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
/** Keep only low-frequency media events, never per-frame history or file contents. */
const DIAGNOSTIC_EVENT_LIMIT = 32;

export interface VideoDiagnosticEvent {
  event: string;
  elapsedMs: number;
  position: number;
  readyState: number;
  networkState: number;
  errorCode: number | null;
}

export interface VideoDiagnostics {
  file: { bytes: number; type: string } | null;
  duration: number | null;
  position: number;
  width: number;
  height: number;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  rate: number;
  readyState: number;
  networkState: number;
  error: { code: number | null; message: string } | null;
  events: VideoDiagnosticEvent[];
}

export interface VideoLoadOptions {
  /** Calls native play in this load() call. The caller must already have the file inside its gesture. */
  play?: boolean;
  /** Requested before play, then bounded by actual metadata before decoded playback. */
  startTime?: number;
  /** Key-locked rate, using the same limits as setTempo(). Omission preserves the current rate. */
  tempo?: number;
}

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
      return `“${name}” could not be decoded. Try a 1080p MP4 with H.264 video and AAC audio.`;
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return `This browser can't play “${name}”. Export an MP4 with H.264 video and AAC audio.`;
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
 * not connected to the engine's AudioContext. Mount `element` before loading; mobile browsers may defer frame
 * decoding while it is detached or hidden. Metadata readiness does not guarantee a decoded video frame.
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
  /** A failed decoder stays failed until the source is explicitly loaded again. */
  private playbackError: string | null = null;
  private url: string | null = null;
  private loadSeq = 0;
  /** Invalidates rejected play promises when a pause, unload or newer play overtakes them. */
  private playSeq = 0;
  /** False blocks a cancelled/refused load-and-play from reviving through a late native play event. */
  private loadPlayIntent: boolean | null = null;
  /** Settles the in-flight load quietly when a newer load / unload supersedes it. */
  private cancelLoad: (() => void) | null = null;
  private frameHandle: number | null = null;
  private frameKind: 'video' | 'animation' = 'animation';
  /** Set when video frame callbacks starve during this playback; cleared on the next play. */
  private framesStarved = false;
  private lastFrameAt = 0;
  private lastReportAt = -Infinity;
  private readonly listeners: [string, EventListener][];
  private diagnosticFile: VideoDiagnostics['file'] = null;
  private diagnosticError: VideoDiagnostics['error'] = null;
  private diagnosticEvents: VideoDiagnosticEvent[] = [];
  private diagnosticStartedAt = 0;
  private disposed = false;

  constructor() {
    const v = document.createElement('video');
    v.playsInline = true;
    // Opening a large phone video should not force a decode/seek before the first Play gesture.
    v.preload = 'metadata';
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
    for (const event of ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ended', 'error']) {
      this.listeners.push([event, () => this.recordDiagnostic(event)]);
    }
    for (const [type, fn] of this.listeners) v.addEventListener(type, fn);
  }

  // ---- track -------------------------------------------------------------------------------

  get track(): LoadedTrack | null {
    return this._track;
  }

  /** Fatal native playback failure, retained until a fresh load or unload. */
  get error(): string | null {
    const nativeError = this.element.error;
    return this.playbackError ?? (nativeError
      ? mediaErrorMessage(nativeError.code, this._track?.name ?? this.element.getAttribute('aria-label') ?? 'video')
      : null);
  }

  /** Local troubleshooting snapshot: no media bytes, filename, object URL or automatic network reporting. */
  getDiagnostics(): VideoDiagnostics {
    const v = this.element;
    return {
      file: this.diagnosticFile ? { ...this.diagnosticFile } : null,
      duration: isUsableDuration(v.duration) ? v.duration : this._track?.duration ?? null,
      position: Number.isFinite(v.currentTime) ? v.currentTime : 0,
      width: v.videoWidth,
      height: v.videoHeight,
      paused: v.paused,
      ended: v.ended,
      seeking: v.seeking,
      rate: v.playbackRate,
      readyState: v.readyState,
      networkState: v.networkState,
      error: this.diagnosticError ? { ...this.diagnosticError } : null,
      events: this.diagnosticEvents.map((event) => ({ ...event })),
    };
  }

  /**
   * Opens `file` (paused, at 0, tempo kept by default). Resolves once its metadata has a usable duration, rejects
   * with a readable message when the browser cannot play it; a load superseded by a newer `load` / `unload`
   * resolves without a track. Revokes the previous file's object URL. Explicit play uses the same element and
   * calls its play() synchronously, before waiting for metadata. A refused play still resolves the loaded track
   * paused so the caller can offer Play; metadata resolution is not proof of autoplay or decoded frames.
   */
  load(file: Blob, name: string, options: VideoLoadOptions = {}): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('VideoDeck is disposed'));
    this.cancelLoad?.();
    const seq = ++this.loadSeq;
    const v = this.element;
    this.playSeq++;
    this.loadPlayIntent = options.play ? true : null;
    const startTime = options.startTime === undefined ? null :
      Number.isFinite(options.startTime) ? Math.max(0, options.startTime) : 0;
    this.playbackError = null;
    this.diagnosticFile = { bytes: file.size, type: file.type };
    this.diagnosticError = null;
    this.diagnosticEvents = [];
    this.diagnosticStartedAt = performance.now();
    this._track = null;
    if (!v.paused) v.pause();
    this.setPlaying(false);
    if (options.tempo !== undefined) this.setTempo(options.tempo);
    this.revokeUrl();
    const url = URL.createObjectURL(file);
    this.url = url;
    v.setAttribute('aria-label', name);

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      /** Probing for the real duration of a file whose header has none (MediaRecorder WebM reports Infinity). */
      let probing = false;
      const done = (): void => {
        clearTimeout(timer);
        for (const [type, fn] of handlers) v.removeEventListener(type, fn);
        if (this.cancelLoad === cancel) this.cancelLoad = null;
      };
      const cancel = (): void => {
        if (settled) return;
        settled = true;
        done();
        resolve();
      };
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        done();
        if (seq === this.loadSeq) {
          this.diagnosticError ??= { code: v.error?.code ?? null, message: this.diagnosticMessage(v.error?.message || message) };
          this.recordDiagnostic('load-failed');
          this.clearSource();
        }
        reject(new Error(message));
      };
      const finish = (duration: number): void => {
        if (settled || seq !== this.loadSeq) return;
        try {
          if (startTime !== null) {
            const position = clampTime(startTime, duration);
            if (v.currentTime !== position) v.currentTime = position;
          }
          else if (probing) v.currentTime = 0;
          applyRate(v, this._tempo);
        } catch {
          fail(`“${name}” could not start at the requested position.`);
          return;
        }
        settled = true;
        done();
        this._track = { name, duration };
        if (options.play && startTime !== null && startTime >= duration) this.pause();
        if (this.loadPlayIntent === false && !v.paused) v.pause();
        this.setPlaying(!v.paused);
        this.onPosition?.(this.position);
        resolve();
      };
      const onMetadata = (): void => {
        if (isUsableDuration(v.duration)) finish(v.duration);
        else if (v.duration === Infinity) {
          // Probing jumps far beyond the real end. Keep it silent and let a later Play gesture resume.
          if (options.play) this.pause();
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
      v.src = url;
      v.load(); // explicit, for iOS Safari, which may otherwise wait for a play before reading metadata
      applyRate(v, this._tempo);
      if (startTime !== null) {
        try { v.currentTime = startTime; } catch { /* Metadata will apply the bounded start before decoded playback. */ }
      }
      if (options.play && seq === this.loadSeq && this.loadPlayIntent === true && !this.error) this.playDuringLoad(seq);
    });
  }

  /** Pauses, removes the source and revokes its object URL; tempo is kept. */
  unload(): void {
    this.cancelLoad?.();
    this.loadSeq++;
    this.playSeq++;
    this.loadPlayIntent = null;
    this.playbackError = null;
    this.diagnosticFile = null;
    this.diagnosticError = null;
    this.diagnosticEvents = [];
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
    if (this.error) { this.handleError(); return; }
    if (!this._track || this._playing) return;
    const v = this.element;
    const seq = ++this.playSeq;
    this.loadPlayIntent = null;
    applyRate(v, this._tempo);
    let started: Promise<void> | undefined;
    try {
      if (v.ended || v.currentTime >= this._track.duration) v.currentTime = 0;
      started = v.play();
    } catch (error) {
      this.recordPlayFailure(error);
      // Some engines throw synchronously. Never leave a silent player reporting "Pause" indefinitely.
      this.setPlaying(false);
      return;
    }
    if (this.error) this.handleError();
    else this.setPlaying(true);
    this.report(true);
    started?.catch((error: unknown) => {
      if (seq !== this.playSeq) return;
      this.recordPlayFailure(error);
      // NotAllowedError (no gesture / locked), AbortError (a pause or load overtook it), NotSupportedError.
      if (v.paused || v.error) this.setPlaying(false);
    });
  }

  pause(): void {
    this.playSeq++;
    if (this.loadPlayIntent !== null) this.loadPlayIntent = false;
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
    if (!track || this.error) return;
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

  /** Directly issued by load(), never from a metadata/canplay callback that would lose the gesture. */
  private playDuringLoad(loadSeq: number): void {
    const v = this.element;
    const playSeq = ++this.playSeq;
    const refused = (error: unknown): void => {
      if (loadSeq !== this.loadSeq || playSeq !== this.playSeq) return;
      this.loadPlayIntent = false;
      this.recordPlayFailure(error);
      if (!v.paused) v.pause();
      this.setPlaying(false);
    };
    try {
      const started = v.play();
      started?.then(() => {
        if (loadSeq !== this.loadSeq) return;
        if (playSeq !== this.playSeq) {
          // A pause invalidated this request. A newer explicit play resets intent and must remain intact.
          if (this.loadPlayIntent === false && !v.paused) v.pause();
          return;
        }
        this.syncPlaying();
      }, refused);
    } catch (error) {
      refused(error);
    }
  }

  private setPlaying(playing: boolean): void {
    if (playing && this.error) playing = false;
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
    if (this.error) { this.handleError(); return; }
    if (this.loadPlayIntent === false && !this.element.paused) this.element.pause();
    const playing = this._track !== null && !this.element.paused;
    this.setPlaying(playing);
    if (!playing) this.report(true);
  }

  private handleEnded(): void {
    // Native events are queued. A final pause/position report can already have launched the next
    // section pass before this old ended event arrives; it must not stop that new playback.
    if (!this._track || this.error || !this.element.ended || !this.element.paused) return;
    this.setPlaying(false);
    this.report(true);
    this.onEnded?.();
  }

  /** A decode error mid-song stops playback (load errors are handled by `load`). */
  private handleError(): void {
    const error = this.error;
    if (!error) return; // An old queued error may arrive after a new load cleared the native failure.
    const nativeError = this.element.error;
    this.diagnosticError = { code: nativeError?.code ?? this.diagnosticError?.code ?? null, message: this.diagnosticMessage(nativeError?.message || error) };
    this.playbackError = error;
    this.playSeq++;
    if (this.loadPlayIntent !== null) this.loadPlayIntent = false;
    try { if (!this.element.paused) this.element.pause(); } catch { /* Native decoder already stopped. */ }
    this.setPlaying(false);
  }

  private recordPlayFailure(error: unknown): void {
    this.diagnosticError = {
      code: this.element.error?.code ?? null,
      message: this.diagnosticMessage(error instanceof Error ? `${error.name}: ${error.message}` : 'Native play was refused.'),
    };
    this.recordDiagnostic('play-rejected');
  }

  private diagnosticMessage(message: string): string {
    const name = this.element.getAttribute('aria-label');
    const redacted = name ? message.split(name).join('[video]') : message;
    return redacted.replace(/(?:blob:|file:\/\/|https?:\/\/|[A-Za-z]:[\\/]|(?<![\w.])\/)[^\s"'<>]+/g, '[source]').slice(0, 1000);
  }

  private recordDiagnostic(event: string): void {
    if (!this.diagnosticFile) return;
    const v = this.element;
    this.diagnosticEvents.push({
      event,
      elapsedMs: Math.max(0, Math.round(performance.now() - this.diagnosticStartedAt)),
      position: Number.isFinite(v.currentTime) ? v.currentTime : 0,
      readyState: v.readyState,
      networkState: v.networkState,
      errorCode: v.error?.code ?? null,
    });
    if (this.diagnosticEvents.length > DIAGNOSTIC_EVENT_LIMIT) this.diagnosticEvents.shift();
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
