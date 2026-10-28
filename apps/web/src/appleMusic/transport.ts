import { playAtOriginalSpeed, type MusicKitInstance } from './client';

export interface AppleMusicTransport {
  /** Remains true until Apple's native operation settles, even after cancellation. */
  readonly seeking: boolean;
  /** Must be called directly from the Play gesture. Never queues a deferred Play. */
  play(): void | Promise<unknown>;
  pause(): void | Promise<unknown>;
  /** Seeks without changing whether the song is playing. Overlapping seeks are refused. */
  seek(seconds: number): Promise<void>;
  /** Cue selection: pause, then seek, and require a new explicit Play gesture. */
  seekPaused(seconds: number): Promise<void>;
  /** Invalidates deferred work and pauses; does not pretend to cancel a native seek. */
  cancel(): void;
  dispose(): void;
}

// A disposed adapter must not release the native operation's lock early. MusicKit is a
// singleton, and a newly mounted player may receive the same instance before it settles.
const seekingInstances = new WeakSet<MusicKitInstance>();
const playbackIntents = new WeakMap<MusicKitInstance, { wantsPlaying: boolean }>();

export function createAppleMusicTransport(instance: MusicKitInstance): AppleMusicTransport {
  let generation = 0;
  let disposed = false;
  const intent = playbackIntents.get(instance) ?? { wantsPlaying: false };
  playbackIntents.set(instance, intent);

  const quietPause = (): void => {
    try { void Promise.resolve(instance.pause()).catch(() => {}); } catch { /* Cleanup cannot throw. */ }
  };
  const assertAvailable = (): void => {
    if (disposed) throw new Error('This player is closed. Open Apple Music again.');
    if (!instance.isAuthorized) throw new Error('Connect Apple Music before playing.');
  };
  const seek = (seconds: number, pauseFirst: boolean): Promise<void> => {
    try {
      assertAvailable();
      if (seekingInstances.has(instance)) throw new Error('The song is still seeking. Try again when it is ready.');
      if (!Number.isFinite(seconds)) throw new Error('Choose a valid position in the song.');
      const duration = instance.currentPlaybackDuration;
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('Wait for the song to load before seeking.');
      const position = Math.min(duration, Math.max(0, seconds));
      const token = ++generation;
      seekingInstances.add(instance);
      let operation: Promise<void>;
      try {
        if (pauseFirst) {
          intent.wantsPlaying = false;
          // Pause is invoked in the original gesture. A delayed completion may seek only
          // while this action is still current; it can never resume audio by itself.
          operation = Promise.resolve(instance.pause()).then(() => {
            if (disposed || token !== generation) throw new Error('Playback action cancelled.');
            assertAvailable();
            return instance.seekToTime(position);
          });
        } else operation = instance.seekToTime(position);
      } catch (error) {
        seekingInstances.delete(instance);
        return Promise.reject(error);
      }
      return operation.then(() => {
        if (disposed || token !== generation) throw new Error('Playback action cancelled.');
      }).finally(() => { seekingInstances.delete(instance); });
    } catch (error) { return Promise.reject(error); }
  };

  const cancel = (): void => {
    generation++;
    intent.wantsPlaying = false;
    quietPause();
  };
  return {
    get seeking() { return seekingInstances.has(instance); },
    play() {
      assertAvailable();
      if (seekingInstances.has(instance)) throw new Error('The song is still seeking. Tap Play when it is ready.');
      intent.wantsPlaying = true;
      try {
        const playing = playAtOriginalSpeed(instance);
        // A Play already in flight must not undo a later Pause or teardown.
        if (playing) return Promise.resolve(playing).then((result) => {
          if (!intent.wantsPlaying) quietPause();
          return result;
        });
      } catch (error) { intent.wantsPlaying = false; throw error; }
    },
    pause() {
      if (disposed) return;
      generation++;
      intent.wantsPlaying = false;
      return instance.pause();
    },
    seek: (seconds) => seek(seconds, false),
    seekPaused: (seconds) => seek(seconds, true),
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
