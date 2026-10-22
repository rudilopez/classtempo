import { describe, expect, it } from 'vitest';
import { CUE_SLOTS, cueKey, emptyCues, loadCues, saveCues, type StorageLike } from './cueStore';

/** Tiny in-memory localStorage stand-in. */
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('cueKey', () => {
  it('namespaces by track name and duration to 2 dp', () => {
    expect(cueKey('song.mp3', 183.456)).toBe('mixdeck.dancer.cues.song.mp3|183.46');
  });
});

describe('loadCues / saveCues', () => {
  it('returns 8 empty slots when nothing is saved', () => {
    const cues = loadCues('x', 10, memoryStorage());
    expect(cues).toHaveLength(CUE_SLOTS);
    expect(cues.every((c) => c === null)).toBe(true);
  });

  it('round-trips cues per track', () => {
    const s = memoryStorage();
    const cues = emptyCues();
    cues[0] = { time: 1.5, name: 'Intro' };
    cues[5] = { time: 42, name: 'Drop' };
    expect(saveCues('a.mp3', 200, cues, s)).toBe(true);
    expect(loadCues('a.mp3', 200, s)).toEqual(cues);
    // a different duration is a different track
    expect(loadCues('a.mp3', 201, s).every((c) => c === null)).toBe(true);
  });

  it('removes the entry when every pad is cleared', () => {
    const s = memoryStorage();
    const cues = emptyCues();
    cues[2] = { time: 3, name: 'Cue 3' };
    saveCues('t', 5, cues, s);
    expect(s.data.size).toBe(1);
    saveCues('t', 5, emptyCues(), s);
    expect(s.data.size).toBe(0);
  });

  it('drops malformed entries and tolerates corrupt JSON', () => {
    const s = memoryStorage();
    s.setItem(cueKey('t', 5), JSON.stringify([{ time: 1, name: 'ok' }, { time: 'nope' }, 7, null, { time: -1, name: 'neg' }]));
    const cues = loadCues('t', 5, s);
    expect(cues).toHaveLength(CUE_SLOTS);
    expect(cues[0]).toEqual({ time: 1, name: 'ok' });
    expect(cues.slice(1).every((c) => c === null)).toBe(true);

    s.setItem(cueKey('t', 5), '{not json');
    expect(loadCues('t', 5, s).every((c) => c === null)).toBe(true);
  });

  it('never throws when storage is missing or throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadCues('t', 5, broken).every((c) => c === null)).toBe(true);
    expect(saveCues('t', 5, emptyCues(), broken)).toBe(false);
    expect(saveCues('t', 5, emptyCues(), null)).toBe(false);
    expect(loadCues('t', 5, null)).toHaveLength(CUE_SLOTS);
  });
});
