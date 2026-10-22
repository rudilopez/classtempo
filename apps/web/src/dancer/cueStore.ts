/**
 * Per-track cue persistence for Dancer mode. Pure helpers: the storage is injectable so tests can
 * pass an in-memory stub, and every storage access is wrapped in try/catch (private windows,
 * blocked site data and corrupt entries all fall back to "no cues").
 */

export interface Cue {
  /** seconds, in track time (independent of tempo) */
  time: number;
  name: string;
}

/** Number of cue pads. */
export const CUE_SLOTS = 8;

/** One entry per pad; null = empty pad. */
export type CueSlots = (Cue | null)[];

/** The subset of Storage the helpers use. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'mixdeck.dancer.cues.';

/** localStorage key for a track, identified by name and duration (2 dp). */
export function cueKey(name: string, duration: number): string {
  return `${PREFIX}${name}|${duration.toFixed(2)}`;
}

export function emptyCues(): CueSlots {
  return Array.from({ length: CUE_SLOTS }, () => null);
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // the accessor itself throws when site data is blocked
  }
}

function isCue(v: unknown): v is Cue {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as { time?: unknown; name?: unknown };
  return typeof c.time === 'number' && Number.isFinite(c.time) && c.time >= 0 && typeof c.name === 'string';
}

/** Restores the cues saved for a track; always returns CUE_SLOTS entries. */
export function loadCues(name: string, duration: number, storage: StorageLike | null = defaultStorage()): CueSlots {
  const cues = emptyCues();
  try {
    const raw = storage?.getItem(cueKey(name, duration));
    if (!raw) return cues;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return cues;
    for (let i = 0; i < CUE_SLOTS; i++) {
      const c: unknown = parsed[i];
      if (isCue(c)) cues[i] = { time: c.time, name: c.name };
    }
  } catch {
    // unavailable storage or corrupt entry: start with no cues
  }
  return cues;
}

/** Saves a track's cues (removes the entry when every pad is empty). Returns false if storage failed. */
export function saveCues(
  name: string,
  duration: number,
  cues: readonly (Cue | null)[],
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    const key = cueKey(name, duration);
    const slots = cues.slice(0, CUE_SLOTS);
    if (slots.every((c) => c === null)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(slots));
    return true;
  } catch {
    return false;
  }
}
