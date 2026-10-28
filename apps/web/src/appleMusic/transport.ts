import { playAtOriginalSpeed, type MusicKitInstance } from './client';

export interface AppleMusicTransport {
  /** Remains true until Apple's native operation settles, even after cancellation. */
  readonly seeking: boolean;
  /** Must be called directly from the Play gesture. Never queues a deferred Play. */
  play(): void | Promise<unknown>;
  pause(): void | Promise<unknown>;
  /** Seeks without changing whether the song is playing. Overlapping seeks are refused. */
  seek(seconds: number): Promise<void>;
  /** Jump and play like a local cue. A paused start invokes Play in the initiating gesture. */
  launchCue(seconds: number): Promise<void>;
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
  const startPlaying = (): void | Promise<unknown> => {
    intent.wantsPlaying = true;
    try {
      const playing = playAtOriginalSpeed(instance);
      // A Play already in flight must not undo a later Pause or teardown. Shared
      // intent also prevents an old adapter from pausing a new explicit Play.
      if (playing) return Promise.resolve(playing).then((result) => {
        if (!intent.wantsPlaying) quietPause();
        return result;
      });
    } catch (error) { intent.wantsPlaying = false; throw error; }
  };
  const seek = (seconds: number, launch: boolean): Promise<void> => {
    try {
      assertAvailable();
      if (seekingInstances.has(instance)) throw new Error('The song is still seeking. Try again when it is ready.');
      if (!Number.isFinite(seconds)) throw new Error('Choose a valid position in the song.');
      const duration = instance.currentPlaybackDuration;
      const wasPlaying = instance.isPlaying;
      const durationReady = Number.isFinite(duration) && duration > 0;
      if (!durationReady && (!launch || wasPlaying)) throw new Error('Wait for the song to load before seeking.');
      const token = ++generation;
      seekingInstances.add(instance);
      const failed = (error: unknown): never => {
        // A failed launch must not leave music playing at the wrong position, but
        // a late failure must never pause a newer song/source/playback action.
        if (launch && !disposed && token === generation) {
          intent.wantsPlaying = false;
          quietPause();
        }
        throw error;
      };
      if (!durationReady) {
        // A newly queued MusicKit song has catalog duration but no native media
        // yet. Start in the gesture, then seek once Apple initializes the stream.
        // Only the seek is deferred, and a later Pause/source change revokes it.
        let starting: void | Promise<unknown>;
        try { starting = startPlaying(); } catch (error) {
          seekingInstances.delete(instance);
          return Promise.reject(error).catch(failed);
        }
        return Promise.resolve(starting).then(() => {
          if (disposed || token !== generation) throw new Error('Playback action cancelled.');
          assertAvailable();
          const loadedDuration = instance.currentPlaybackDuration;
          if (!Number.isFinite(loadedDuration) || loadedDuration <= 0) throw new Error('Wait for the song to load before seeking.');
          return instance.seekToTime(Math.min(loadedDuration, Math.max(0, seconds)));
        }).then(() => {
          if (disposed || token !== generation) throw new Error('Playback action cancelled.');
        }).catch(failed).finally(() => { seekingInstances.delete(instance); });
      }
      const position = Math.min(duration, Math.max(0, seconds));
      let nativeSeek: Promise<void>;
      try {
        if (launch) instance.playbackRate = 1;
        nativeSeek = instance.seekToTime(position);
      } catch (error) {
        seekingInstances.delete(instance);
        return Promise.reject(error).catch(failed);
      }
      // Only the native seek settling can release this lock. A failed Play may
      // finish sooner, and disposing this adapter does not cancel Apple's seek.
      const seeking = nativeSeek.finally(() => { seekingInstances.delete(instance); });
      let playing: void | Promise<unknown> = undefined;
      try {
        if (launch) {
          intent.wantsPlaying = true;
          // Never pause an active stream. For a paused cue, seek and Play are both
          // invoked synchronously from the tap, preserving browser permission.
          if (!wasPlaying) playing = startPlaying();
        }
      } catch (error) { playing = Promise.reject(error); }
      return Promise.all([seeking, playing]).then(() => {
        if (disposed || token !== generation) throw new Error('Playback action cancelled.');
      }).catch(failed);
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
      generation++;
      return startPlaying();
    },
    pause() {
      if (disposed) return;
      generation++;
      intent.wantsPlaying = false;
      return instance.pause();
    },
    seek: (seconds) => seek(seconds, false),
    launchCue: (seconds) => seek(seconds, true),
    cancel,
    dispose() { disposed = true; cancel(); },
  };
}
