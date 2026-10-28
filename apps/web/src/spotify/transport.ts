import type { MusicTrack, SpotifyPlayer } from './client';

export interface SpotifyTransport {
  readonly pending: boolean;
  readonly preparedPosition: number | null;
  play(track: MusicTrack, position?: number): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number, playing: boolean): Promise<void>;
  cancel(): void;
  dispose(): void;
}

/** Intent guards sit above Spotify; selecting or preparing a paused cue never starts a stream. */
export function createSpotifyTransport(player: SpotifyPlayer): SpotifyTransport {
  let disposed = false;
  let revision = 0;
  let wantsPlaying = false;
  let pending = false;
  let prepared: number | null = null;
  let selectedId: string | null = null;
  const quietPause = () => { try { void player.pause().catch(() => {}); } catch { /* Cleanup cannot throw. */ } };
  const available = () => { if (disposed) throw new Error('This Spotify player is closed.'); };
  const cancel = () => { revision++; wantsPlaying = false; prepared = null; selectedId = null; quietPause(); };
  return {
    get pending() { return pending; },
    get preparedPosition() {
      const state = player.snapshot();
      if (prepared !== null && wantsPlaying && state.playing && state.trackId === selectedId && state.position >= prepared - 0.25) prepared = null;
      return prepared;
    },
    async play(track, position) {
      available();
      if (pending) throw new Error('Wait for Spotify to finish the current action.');
      if (position !== undefined && !Number.isFinite(position)) throw new Error('Choose a valid song position.');
      // Activation must happen synchronously, before the first await.
      player.activate();
      const token = ++revision;
      wantsPlaying = true; pending = true;
      const state = player.snapshot();
      const target = Math.max(0, Math.min(track.durationSeconds, position ?? prepared ?? 0));
      const resume = state.trackId === track.id && selectedId === track.id && prepared === null && position === undefined;
      selectedId = track.id;
      if (!resume) prepared = target;
      try {
        await (resume ? player.resume() : player.start(track, target));
        if (disposed || token !== revision) { if (disposed || !wantsPlaying) quietPause(); return; }
      } catch (error) { if (token === revision) { wantsPlaying = false; quietPause(); } throw error; }
      finally { pending = false; }
    },
    async pause() { available(); revision++; wantsPlaying = false; await player.pause(); },
    async seek(seconds, playing) {
      available();
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Choose a valid song position.');
      // A paused cue also revokes a Play which has been requested but has not begun.
      if (!playing) {
        revision++; wantsPlaying = false; prepared = seconds; quietPause();
        // Preparing locally is intentional, including when the SDK has not loaded this selection.
        return;
      }
      if (pending) throw new Error('Wait for Spotify to finish the current action.');
      const token = ++revision; wantsPlaying = true; pending = true;
      try { await player.seek(seconds); if (!disposed && token === revision) prepared = null; }
      finally { pending = false; if (disposed || !wantsPlaying) quietPause(); }
    },
    cancel,
    dispose() { if (disposed) return; disposed = true; cancel(); player.dispose(); },
  };
}
