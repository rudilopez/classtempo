import { CUE_SLOTS, emptyCues, type CueSlots, type StorageLike } from '../dancer/cueStore';
import { isYouTubeVideoId } from './video';

export function youtubeCueKey(id: string): string { return `classtempo.youtube.cues.video.${id}`; }
function storage(): StorageLike | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }

function normalize(value: unknown, duration: number): CueSlots {
  const result = emptyCues();
  if (!Array.isArray(value) || !Number.isFinite(duration) || duration < 0) return result;
  for (let i = 0; i < CUE_SLOTS; i++) {
    const cue: unknown = value[i];
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) continue;
    const data = cue as { time?: unknown; name?: unknown };
    if (typeof data.time !== 'number' || !Number.isFinite(data.time) || data.time < 0 || data.time > Number.MAX_SAFE_INTEGER || typeof data.name !== 'string') continue;
    result[i] = { time: duration > 0 ? Math.min(data.time, duration) : data.time, name: data.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40) || `Cue ${i + 1}` };
  }
  return result;
}

export function loadYouTubeCues(id: string, duration: number, target: StorageLike | null = storage()): CueSlots {
  try {
    if (!isYouTubeVideoId(id)) return emptyCues();
    const raw = target?.getItem(youtubeCueKey(id));
    return raw && raw.length <= 20_000 ? normalize(JSON.parse(raw) as unknown, duration) : emptyCues();
  } catch { return emptyCues(); }
}

export function saveYouTubeCues(id: string, duration: number, cues: CueSlots, target: StorageLike | null = storage()): boolean {
  try {
    if (!target || !isYouTubeVideoId(id) || !Number.isFinite(duration) || duration < 0) return false;
    const clean = normalize(cues, duration);
    if (clean.every(cue => cue === null)) target.removeItem(youtubeCueKey(id));
    else target.setItem(youtubeCueKey(id), JSON.stringify(clean));
    return true;
  } catch { return false; }
}
