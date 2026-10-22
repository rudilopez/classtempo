/**
 * Lock-screen and headphone controls via the Media Session API. Thin, feature-detected, never-throwing helpers
 * over `navigator.mediaSession`; browsers without it (or without an action) skip that part silently.
 * seekbackward / seekforward are never registered (always cleared), so iOS shows previous / next track buttons
 * instead of ±10 s skips, and headphone double / triple presses reach `nexttrack` / `previoustrack`.
 *
 * WebKit ordering rule (see the evidence block in keepAlive.ts): moving `playbackState` into 'playing' starts a
 * playback session of its own for the page's Media Session, and WebKit enables lock-screen scrubbing only when
 * the session that started playback last can seek, which that one cannot. So set 'playing' *before* starting the
 * keep-alive (or the video element), and when `setPlaybackState` returns true while it is already playing, call
 * `keepAlive.claim()`.
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

/**
 * Changes only the second line of the current Now Playing metadata (e.g. the cue section), keeping title and
 * artwork, so the artwork is not fetched again. No-op before `setNowPlaying` or after `clearMediaSession`.
 */
export function setNowPlayingArtist(artist: string): void {
  const metadata = session()?.metadata;
  if (!metadata) return;
  try {
    if (metadata.artist !== artist) metadata.artist = artist;
  } catch {
    // Read-only in this browser.
  }
}

/**
 * Tells the OS whether the app is playing (drives the play/pause button and, on some platforms, the scrubber).
 * Returns true when this call moved the Media Session into 'playing' from another state: on WebKit that just
 * started the Media Session's own (non-seekable) playback session, so a keep-alive that was already playing must
 * `claim()` again. Returns false otherwise, and where the API is missing.
 */
export function setPlaybackState(state: MediaSessionPlaybackState): boolean {
  const ms = session();
  if (!ms) return false;
  try {
    const before = ms.playbackState;
    ms.playbackState = state;
    return state === 'playing' && before !== 'playing';
  } catch {
    // Read-only or unsupported.
    return false;
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

/** The handlers of the last `setHandlers`, for `refreshHandlers`; null after `clearMediaSession`. */
let registered: MediaHandlers | null = null;

/** Registers `handlers`; every other handled action, and seekbackward / seekforward, is set to null. */
export function setHandlers(handlers: MediaHandlers): void {
  registered = { ...handlers };
  const ms = session();
  if (!ms) return;
  for (const action of ACTIONS) setAction(ms, action, handlers[action] ?? null);
  for (const action of SKIP_ACTIONS) setAction(ms, action, null);
}

/**
 * Registers the handlers of the last `setHandlers` again (no-op before it and after `clearMediaSession`). WebKit
 * drops a handler registered while the page has no media session yet, and its lock screen then falls back to
 * ±15 s skips without previous / next; calling this once the keep-alive is playing (its `onStarted` option)
 * makes sure the lock screen has them. Re-registering also makes WebKit recompute whether scrubbing is allowed.
 */
export function refreshHandlers(): void {
  if (registered) setHandlers(registered);
}

/** Removes metadata, position, playback state and every handler (e.g. when leaving a mode). */
export function clearMediaSession(): void {
  registered = null;
  const ms = session();
  if (!ms) return;
  for (const action of ACTIONS) setAction(ms, action, null);
  for (const action of SKIP_ACTIONS) setAction(ms, action, null);
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
