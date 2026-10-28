import type { MusicKitInstance, MusicTrack } from './client';

export type AppleMusicSeekTrack = Pick<MusicTrack, 'id' | 'durationSeconds'>;
export interface AppleMusicTransportOptions { tempoTrial?: boolean }

const TEMPO_RATE_MIN = 0.5;
const TEMPO_RATE_MAX = 1.5;

export interface AppleMusicTransport {
  /** Remains true until Apple's native operation settles, even after cancellation. */
  readonly seeking: boolean;
  /** A prepared paused queue position until native playback reaches that position. */
  readonly preparedPosition: number | null;
  /** Requested speed; adapters without tempo enabled always request 1. */
  readonly requestedRate: number;
  /** Changes rate in whole-percent steps without starting playback; range 0.5..1.5. */
  setTempoRate(rate: number): void;
  /** Ends the audition at original speed, paused, retaining the prepared cue position. */
  endTempoTrial(): void;
  /** Must be called directly from the Play gesture. Never queues a deferred Play. */
  play(): void | Promise<unknown>;
  pause(): void | Promise<unknown>;
  /** Move to a position while preserving playing/paused state. A fresh paused song needs its catalog identity. */
  seek(seconds: number, track?: AppleMusicSeekTrack): Promise<void>;
  /** Invalidates deferred work and pauses; does not pretend to cancel a native operation. */
  cancel(): void;
  dispose(): void;
}

// MusicKit is a singleton. Keep a native operation locked even across player remounts.
const seekingInstances = new WeakSet<MusicKitInstance>();
const playbackIntents = new WeakMap<MusicKitInstance, { wantsPlaying: boolean; revision: number }>();

export function createAppleMusicTransport(instance: MusicKitInstance, options: AppleMusicTransportOptions = {}): AppleMusicTransport {
  let generation = 0;
  let disposed = false;
  let preparedPosition: number | null = null;
  let preparedPlayRequested = false;
  let requestedRate = 1;
  let tempoTrialEnabled = options.tempoTrial === true;
  const intent = playbackIntents.get(instance) ?? { wantsPlaying: false, revision: 0 };
  playbackIntents.set(instance, intent);

  const quietPause = (): void => {
    try { void Promise.resolve(instance.pause()).catch(() => {}); } catch { /* Cleanup cannot throw. */ }
  };
  const resetRate = (): void => {
    requestedRate = 1;
    try { instance.playbackRate = 1; } catch { /* Cleanup cannot throw. */ }
  };
  const applyRate = (rate = requestedRate): void => {
    try { instance.playbackRate = rate; } catch {
      resetRate();
      intent.wantsPlaying = false;
      quietPause();
      // SDK errors can contain provider details. Do not expose them in the trial UI.
      throw new Error('Apple Music could not change tempo. Try again at 100%.');
    }
  };
  const assertAvailable = (): void => {
    if (disposed) throw new Error('This player is closed. Open Apple Music again.');
    if (!instance.isAuthorized) throw new Error('Connect Apple Music before playing.');
  };
  const startPlaying = (): void | Promise<unknown> => {
    const revision = ++intent.revision;
    intent.wantsPlaying = true;
    preparedPlayRequested = preparedPosition !== null;
    const completed = (result: unknown): unknown => {
      if (!intent.wantsPlaying) quietPause();
      // A native Play may reset the rate. Only the current Play may restore the
      // latest requested speed; an old completion must not change a new song.
      else if (!disposed && intent.revision === revision && tempoTrialEnabled) applyRate();
      return result;
    };
    const failed = (error: unknown): never => {
      if (intent.revision === revision) {
        intent.wantsPlaying = false;
        preparedPlayRequested = false;
      }
      throw error;
    };
    try {
      applyRate();
      const playing = instance.play();
      // A Play already in flight must not undo a later Pause or teardown. Shared
      // intent prevents an old adapter from pausing a new explicit Play.
      if (playing) return Promise.resolve(playing).then(completed, failed);
      completed(undefined);
    } catch (error) { failed(error); }
  };
  const seek = (seconds: number, track?: AppleMusicSeekTrack): Promise<void> => {
    try {
      assertAvailable();
      if (seekingInstances.has(instance)) throw new Error('The song is still seeking. Try again when it is ready.');
      if (!Number.isFinite(seconds)) throw new Error('Choose a valid position in the song.');
      const nativeDuration = instance.currentPlaybackDuration;
      const nativeReady = Number.isFinite(nativeDuration) && nativeDuration > 0;
      const duration = nativeReady ? nativeDuration : track?.durationSeconds;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) throw new Error('Wait for the song to load before seeking.');
      const wasPlaying = instance.isPlaying;
      if (!nativeReady && (wasPlaying || !track?.id.trim())) throw new Error('Wait for the song to load before seeking.');
      const target = Math.min(duration, Math.max(0, seconds));
      const token = ++generation;
      const revision = ++intent.revision;
      // A cue tapped while actually paused must also revoke an older pending Play.
      const wasStarting = intent.wantsPlaying && !wasPlaying;
      intent.wantsPlaying = wasPlaying;
      if (wasStarting) quietPause();
      seekingInstances.add(instance);
      let operation: Promise<unknown>;
      try {
        applyRate();
        // A fresh queue has catalog metadata but no native media to seek. Prepare
        // its start offset without ever starting audio; only a later Play may do so.
        operation = nativeReady ? instance.seekToTime(target)
          : instance.setQueue({ song: track!.id, startPlaying: false, startTime: target });
      } catch (error) {
        seekingInstances.delete(instance);
        return Promise.reject(error);
      }
      return operation.then(() => {
        if (disposed || token !== generation || revision !== intent.revision) throw new Error('Playback action cancelled.');
        assertAvailable();
        if (tempoTrialEnabled) applyRate();
        preparedPosition = nativeReady ? null : target;
        preparedPlayRequested = false;
      }).finally(() => { seekingInstances.delete(instance); });
    } catch (error) { return Promise.reject(error); }
  };

  const cancel = (): void => {
    generation++;
    preparedPosition = null;
    preparedPlayRequested = false;
    intent.revision++;
    intent.wantsPlaying = false;
    resetRate();
    quietPause();
  };
  return {
    get seeking() { return seekingInstances.has(instance); },
    get requestedRate() { return requestedRate; },
    setTempoRate(rate) {
      assertAvailable();
      if (!Number.isFinite(rate) || rate < TEMPO_RATE_MIN || rate > TEMPO_RATE_MAX) {
        throw new Error('Choose a tempo between 50% and 150%.');
      }
      // Slider and nudge controls use whole percentages. Normalize arithmetic
      // noise and fractional programmatic inputs before applying or storing.
      const normalizedRate = Math.round(rate * 100) / 100;
      if (normalizedRate !== 1 && !tempoTrialEnabled) throw new Error('Apple Music tempo is available only in the listening trial.');
      applyRate(normalizedRate);
      requestedRate = normalizedRate;
    },
    endTempoTrial() {
      if (disposed) return;
      tempoTrialEnabled = false;
      generation++;
      intent.revision++;
      intent.wantsPlaying = false;
      preparedPlayRequested = false;
      resetRate();
      quietPause();
    },
    get preparedPosition() {
      // Do not let MusicKit's initial zero replace the chosen paused cue. Once
      // native playback reaches it, native time is authoritative again.
      if (preparedPosition !== null && preparedPlayRequested && instance.isPlaying &&
        Number.isFinite(instance.currentPlaybackTime) && instance.currentPlaybackTime >= preparedPosition - 0.25) preparedPosition = null;
      return preparedPosition;
    },
    play() {
      assertAvailable();
      if (seekingInstances.has(instance)) throw new Error('The song is still seeking. Tap Play when it is ready.');
      generation++;
      return startPlaying();
    },
    pause() {
      if (disposed) return;
      generation++;
      intent.revision++;
      intent.wantsPlaying = false;
      return instance.pause();
    },
    seek,
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
