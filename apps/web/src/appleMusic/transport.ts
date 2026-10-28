import { playAtOriginalSpeed, type MusicKitInstance, type MusicTrack } from './client';

export type AppleMusicSeekTrack = Pick<MusicTrack, 'id' | 'durationSeconds'>;

export interface AppleMusicTransport {
  /** Remains true until Apple's native operation settles, even after cancellation. */
  readonly seeking: boolean;
  /** A prepared paused queue position until native playback reaches that position. */
  readonly preparedPosition: number | null;
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
const playbackIntents = new WeakMap<MusicKitInstance, { wantsPlaying: boolean }>();

export function createAppleMusicTransport(instance: MusicKitInstance): AppleMusicTransport {
  let generation = 0;
  let disposed = false;
  let preparedPosition: number | null = null;
  let preparedPlayRequested = false;
  const intent = playbackIntents.get(instance) ?? { wantsPlaying: false };
  playbackIntents.set(instance, intent);

  const quietPause = (): void => {
    try { void Promise.resolve(instance.pause()).catch(() => {}); } catch { /* Cleanup cannot throw. */ }
  };
  const assertAvailable = (): void => {
    if (disposed) throw new Error('This player is closed. Open Apple Music again.');
    if (!instance.isAuthorized) throw new Error('Connect Apple Music before playing.');
  };
  const startPlaying = (): void | Promise<unknown> => {
    intent.wantsPlaying = true;
    preparedPlayRequested = preparedPosition !== null;
    try {
      const playing = playAtOriginalSpeed(instance);
      // A Play already in flight must not undo a later Pause or teardown. Shared
      // intent prevents an old adapter from pausing a new explicit Play.
      if (playing) return Promise.resolve(playing).then((result) => {
        if (!intent.wantsPlaying) quietPause();
        return result;
      });
    } catch (error) { intent.wantsPlaying = false; throw error; }
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
      // A cue tapped while actually paused must also revoke an older pending Play.
      const wasStarting = intent.wantsPlaying && !wasPlaying;
      intent.wantsPlaying = wasPlaying;
      if (wasStarting) quietPause();
      seekingInstances.add(instance);
      let operation: Promise<unknown>;
      try {
        instance.playbackRate = 1;
        // A fresh queue has catalog metadata but no native media to seek. Prepare
        // its start offset without ever starting audio; only a later Play may do so.
        operation = nativeReady ? instance.seekToTime(target)
          : instance.setQueue({ song: track!.id, startPlaying: false, startTime: target });
      } catch (error) {
        seekingInstances.delete(instance);
        return Promise.reject(error);
      }
      return operation.then(() => {
        if (disposed || token !== generation) throw new Error('Playback action cancelled.');
        assertAvailable();
        preparedPosition = nativeReady ? null : target;
        preparedPlayRequested = false;
      }).finally(() => { seekingInstances.delete(instance); });
    } catch (error) { return Promise.reject(error); }
  };

  const cancel = (): void => {
    generation++;
    preparedPosition = null;
    preparedPlayRequested = false;
    intent.wantsPlaying = false;
    quietPause();
  };
  return {
    get seeking() { return seekingInstances.has(instance); },
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
      intent.wantsPlaying = false;
      return instance.pause();
    },
    seek,
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
