/**
 * Lock-screen and headphone controls via the Media Session API. Thin, feature-detected, never-throwing helpers
 * over `navigator.mediaSession`; browsers without it (or without an action) skip that part silently.
 * seekbackward / seekforward are never registered (always cleared), so iOS shows previous / next track buttons
 * instead of ±10 s skips, and headphone double / triple presses reach `nexttrack` / `previoustrack`.
 */

/** The actions MixDeck handles. */
export type MediaAction = 'play' | 'pause' | 'stop' | 'previoustrack' | 'nexttrack' | 'seekto';

/** Handlers by action; an action left out is unregistered. */
export type MediaHandlers = Partial<Record<MediaAction, MediaSessionActionHandler>>;

export interface NowPlaying {
  title: string;
  /** Second line on the lock screen, e.g. the mode ("Dancer mode"). */
  artist?: string;
  /** Defaults to the app icons. */
  artwork?: MediaImage[];
}

export interface PositionState {
  /** Track length, seconds. */
  duration: number;
  /** Playhead, seconds. */
  position: number;
  /** Playback rate (tempo), 1 = normal; the lock-screen scrubber advances at this rate. */
  rate: number;
}

const ACTIONS: readonly MediaAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto'];
/** Cleared on every `setHandlers` so the lock screen shows previous / next track instead. */
const SKIP_ACTIONS: readonly MediaSessionAction[] = ['seekbackward', 'seekforward'];

/** The app icons, relative to the document so the app works under a sub-path. */
export const DEFAULT_ARTWORK: readonly MediaImage[] = [
  { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
];

function session(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null;
}

function setAction(ms: MediaSession, action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
  try {
    ms.setActionHandler(action, handler);
  } catch {
    // Action not supported by this browser.
  }
}

/** Sets the lock-screen title, second line and artwork. */
export function setNowPlaying({ title, artist = '', artwork }: NowPlaying): void {
  const ms = session();
  if (!ms || typeof MediaMetadata !== 'function') return;
  try {
    ms.metadata = new MediaMetadata({ title, artist, artwork: artwork ?? [...DEFAULT_ARTWORK] });
  } catch {
    // Invalid artwork URL or metadata unsupported.
  }
}

/** Tells the OS whether the app is playing (drives the play/pause button and, on some platforms, the scrubber). */
export function setPlaybackState(state: MediaSessionPlaybackState): void {
  const ms = session();
  if (!ms) return;
  try {
    ms.playbackState = state;
  } catch {
    // Read-only or unsupported.
  }
}

/**
 * Updates the lock-screen scrubber. Ignored unless `duration` is finite and > 0 and `rate` is finite and > 0;
 * `position` is clamped to 0…duration (non-finite is ignored). Call after every play/pause, seek, cue launch
 * and tempo change: the OS extrapolates from here at `rate`.
 */
export function setPosition({ duration, position, rate }: PositionState): void {
  const ms = session();
  if (!ms || typeof ms.setPositionState !== 'function') return;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(rate) || rate <= 0) return;
  if (!Number.isFinite(position)) return;
  try {
    ms.setPositionState({ duration, position: Math.min(duration, Math.max(0, position)), playbackRate: rate });
  } catch {
    // Rejected by the browser.
  }
}

/** Registers `handlers`; every other handled action, and seekbackward / seekforward, is set to null. */
export function setHandlers(handlers: MediaHandlers): void {
  const ms = session();
  if (!ms) return;
  for (const action of ACTIONS) setAction(ms, action, handlers[action] ?? null);
  for (const action of SKIP_ACTIONS) setAction(ms, action, null);
}

/** Removes metadata, position, playback state and every handler (e.g. when leaving a mode). */
export function clearMediaSession(): void {
  const ms = session();
  if (!ms) return;
  setHandlers({});
  try {
    ms.metadata = null;
  } catch {
    // Unsupported.
  }
  setPlaybackState('none');
  try {
    ms.setPositionState?.();
  } catch {
    // Unsupported.
  }
}
