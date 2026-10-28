import type { MusicTrack } from './client';

export type CleanRestartStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = 'classtempo.apple-music.clean-restart.v1';
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_RECORD_LENGTH = 5000;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

/** Explicit field selection keeps tokens, playback state and audio out of the handoff. */
function trackMetadata(value: unknown): MusicTrack | null {
  const candidate = record(value);
  if (!candidate) return null;
  const id = text(candidate.id, 256);
  const name = text(candidate.name, 500);
  const artist = text(candidate.artist, 500);
  if (!id || id !== id.trim() || !name || !artist ||
    (candidate.type !== 'songs' && candidate.type !== 'library-songs')) return null;
  const track: MusicTrack = { id, type: candidate.type, name, artist };
  if (candidate.album !== undefined) {
    const album = text(candidate.album, 500);
    if (!album) return null;
    track.album = album;
  }
  if (candidate.artworkUrl !== undefined) {
    const artwork = text(candidate.artworkUrl, 2000);
    if (!artwork) return null;
    const url = new URL(artwork);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    track.artworkUrl = artwork;
  }
  if (candidate.durationSeconds !== undefined) {
    if (typeof candidate.durationSeconds !== 'number' || !Number.isFinite(candidate.durationSeconds) || candidate.durationSeconds <= 0) return null;
    track.durationSeconds = candidate.durationSeconds;
  }
  return track;
}

/** Only metadata is saved; calling this never pauses, reloads, connects or starts playback. */
export function saveCleanRestart(track: MusicTrack, storage?: CleanRestartStorage | null, now = Date.now()): boolean {
  try {
    const target = storage === undefined ? (typeof sessionStorage === 'undefined' ? null : sessionStorage) : storage;
    if (!target) return false;
    // A refused replacement must not leave a different song queued for a later restart.
    target.removeItem(KEY);
    if (!Number.isFinite(now) || now < 0) return false;
    const metadata = trackMetadata(track);
    if (!metadata) return false;
    const raw = JSON.stringify({ version: 1, savedAt: now, track: metadata });
    if (raw.length > MAX_RECORD_LENGTH) return false;
    target.setItem(KEY, raw);
    return true;
  } catch {
    return false;
  }
}

/** Consume exactly once, including malformed/expired records; removal failure never returns a track. */
export function takeCleanRestart(storage?: CleanRestartStorage | null, now = Date.now()): MusicTrack | null {
  try {
    const target = storage === undefined ? (typeof sessionStorage === 'undefined' ? null : sessionStorage) : storage;
    if (!target) return null;
    const raw = target.getItem(KEY);
    target.removeItem(KEY);
    if (!raw || raw.length > MAX_RECORD_LENGTH || !Number.isFinite(now) || now < 0) return null;
    const saved = record(JSON.parse(raw) as unknown);
    if (!saved || saved.version !== 1 || typeof saved.savedAt !== 'number' || !Number.isFinite(saved.savedAt) || saved.savedAt < 0) return null;
    const age = now - saved.savedAt;
    if (age < 0 || age >= MAX_AGE_MS) return null;
    return trackMetadata(saved.track);
  } catch {
    return null;
  }
}
