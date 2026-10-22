import type { LoadedTrack } from './deck';

/**
 * The single-track, key-locked player Dancer mode drives, whatever the source:
 * - `StretchDeck` (kind 'audio'): audio files, decoded into memory and played by the Signalsmith Stretch worklet;
 * - `VideoDeck` (kind 'video'): video files, played by a `<video>` element straight from the file (the browser's
 *   own key-locked time-stretch via `preservesPitch`), so a large phone video is never decoded into memory.
 *
 * All times are seconds in track time; tempo is a playback-rate multiplier and never changes pitch.
 */
export interface DancerPlayer {
  readonly kind: 'audio' | 'video';
  /** The loaded track, or null while empty or loading. */
  readonly track: LoadedTrack | null;
  readonly playing: boolean;
  /** Seconds, clamped to [0, duration]; 0 with no track. */
  readonly position: number;
  /** Playback-rate multiplier, `STRETCH_MIN_TEMPO`..`STRETCH_MAX_TEMPO`, default 1. */
  readonly tempo: number;

  /** Regularly while playing (≈20×/s), and after every transport change. */
  onPosition: ((seconds: number) => void) | null;
  /** Once when playback reaches the end; the player is then paused at `duration`. */
  onEnded: (() => void) | null;
  /**
   * Fires on every play/pause transition — the player's own (`play`, `pause`, `jumpTo`, `load`, `unload`), the
   * end of the track (before `onEnded`), and ones the OS causes (lock screen, interruptions, a refused `play`).
   */
  onPlayingChange: ((playing: boolean) => void) | null;

  /** Resumes; from the end it restarts at 0. Call it inside a user gesture or a Media Session handler. */
  play(): void;
  pause(): void;
  toggle(): void;
  /** Works playing or paused; the play state is unchanged. */
  seek(seconds: number): void;
  /** Seek and play — cue launch. */
  jumpTo(seconds: number): void;
  /** Clamped to `STRETCH_MIN_TEMPO`..`STRETCH_MAX_TEMPO`; non-finite values are ignored. */
  setTempo(rate: number): void;
  /** Empties the player (paused, no track); tempo is kept. */
  unload(): void;
}
