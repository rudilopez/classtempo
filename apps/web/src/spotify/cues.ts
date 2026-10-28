import { CUE_SLOTS, emptyCues, type CueSlots, type StorageLike } from '../dancer/cueStore';
import type { MusicTrack } from './client';

type CueTrack = Pick<MusicTrack, 'id'>;
const PREFIX = 'classtempo.spotify.cues.track.';
export function spotifyCueKey(track: CueTrack): string { return `${PREFIX}${encodeURIComponent(track.id)}`; }
function storage(): StorageLike | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
function normalize(value: unknown, duration: number): CueSlots {
  const result = emptyCues();
  if (!Array.isArray(value) || !Number.isFinite(duration) || duration <= 0) return result;
  for (let i = 0; i < CUE_SLOTS; i++) {
    const cue = value[i] as { time?: unknown; name?: unknown } | null;
    if (!cue || typeof cue !== 'object' || !Number.isFinite(cue.time) || typeof cue.time !== 'number' || cue.time < 0 || typeof cue.name !== 'string') continue;
    result[i] = { time: Math.min(cue.time, duration), name: cue.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || `Cue ${i + 1}` };
  }
  return result;
}
export function loadSpotifyCues(track: CueTrack, duration: number, target: StorageLike | null = storage()): CueSlots {
  try { const raw = target?.getItem(spotifyCueKey(track)); return raw ? normalize(JSON.parse(raw) as unknown, duration) : emptyCues(); } catch { return emptyCues(); }
}
export function saveSpotifyCues(track: CueTrack, duration: number, cues: CueSlots, target: StorageLike | null = storage()): boolean {
  try {
    if (!target || !Number.isFinite(duration) || duration <= 0) return false;
    const clean = normalize(cues, duration); const key = spotifyCueKey(track);
    if (clean.every((cue) => cue === null)) target.removeItem(key); else target.setItem(key, JSON.stringify(clean));
    return true;
  } catch { return false; }
}

/** Explicit account disconnect only; changing source preserves cue work. */
export function clearSpotifyCues(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch { /* Storage may be unavailable; account teardown still continues. */ }
}
