import { CUE_SLOTS, emptyCues, type CueSlots, type StorageLike } from '../dancer/cueStore';
import type { MusicTrack } from './client';

type CueTrack = Pick<MusicTrack, 'type' | 'id'>;
const PREFIX = 'classtempo.apple-music.cues.';
const MAX_NAME_LENGTH = 80;

/** Provider identity stays independent of local filenames, duration and editable titles. */
export function appleMusicCueKey(track: CueTrack): string {
  return `${PREFIX}${track.type}.${encodeURIComponent(track.id)}`;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function normalizedCues(value: unknown, duration: number): CueSlots {
  const slots = emptyCues();
  if (!Array.isArray(value) || !Number.isFinite(duration) || duration <= 0) return slots;
  for (let i = 0; i < CUE_SLOTS; i++) {
    const candidate: unknown = value[i];
    if (!candidate || typeof candidate !== 'object') continue;
    const cue = candidate as { time?: unknown; name?: unknown };
    if (typeof cue.time !== 'number' || !Number.isFinite(cue.time) || cue.time < 0 || typeof cue.name !== 'string') continue;
    const name = cue.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
    slots[i] = { time: Math.min(cue.time, duration), name: name || `Cue ${i + 1}` };
  }
  return slots;
}

export function loadAppleMusicCues(track: CueTrack, duration: number, storage: StorageLike | null = defaultStorage()): CueSlots {
  try {
    const raw = storage?.getItem(appleMusicCueKey(track));
    return raw ? normalizedCues(JSON.parse(raw) as unknown, duration) : emptyCues();
  } catch { return emptyCues(); }
}

/** Saves cue positions/names only; no account identifier, token or streaming audio. */
export function saveAppleMusicCues(
  track: CueTrack,
  duration: number,
  cues: CueSlots,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    if (!storage || !Number.isFinite(duration) || duration <= 0) return false;
    const key = appleMusicCueKey(track);
    const slots = normalizedCues(cues, duration);
    if (slots.every((cue) => cue === null)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(slots));
    return true;
  } catch { return false; }
}
