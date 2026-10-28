import { describe, expect, it } from 'vitest';
import { emptyCues, type StorageLike } from '../dancer/cueStore';
import { appleMusicCueKey, loadAppleMusicCues, saveAppleMusicCues } from './cues';

const track = { type: 'songs' as const, id: '123' };
function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

describe('Apple Music cue persistence', () => {
  it('identifies cues by provider type and ID, not file names, titles or duration', () => {
    const storage = memoryStorage();
    const cues = emptyCues(); cues[2] = { name: 'Chorus', time: 42 };
    expect(saveAppleMusicCues(track, 120, cues, storage)).toBe(true);
    expect(loadAppleMusicCues(track, 121, storage)).toEqual(cues);
    expect(loadAppleMusicCues({ type: 'library-songs', id: '123' }, 120, storage)).toEqual(emptyCues());
    expect(loadAppleMusicCues({ type: 'songs', id: '124' }, 120, storage)).toEqual(emptyCues());
    expect(appleMusicCueKey(track)).not.toContain('mixdeck.dancer.cues.');
    expect(JSON.parse([...storage.data.values()].join(''))).toEqual(cues);
  });

  it('clamps restored cue positions when the provider duration changes', () => {
    const storage = memoryStorage();
    const cues = emptyCues(); cues[0] = { name: 'End', time: 200 };
    saveAppleMusicCues(track, 200, cues, storage);
    expect(loadAppleMusicCues(track, 150, storage)[0]).toEqual({ name: 'End', time: 150 });
  });

  it('keeps eight slots and validates stored timestamps and labels', () => {
    const storage = memoryStorage();
    storage.setItem(appleMusicCueKey(track), JSON.stringify([
      { time: 5, name: ' Intro\n ' }, { time: -1, name: 'bad' }, { time: '6', name: 'bad' },
      { time: 150, name: '' }, null, { time: 10, name: 'x'.repeat(100) }, 7, null,
      { time: 1, name: 'ninth' },
    ]));
    const cues = loadAppleMusicCues(track, 120, storage);
    expect(cues).toHaveLength(8);
    expect(cues[0]).toEqual({ time: 5, name: 'Intro' });
    expect(cues[1]).toBeNull(); expect(cues[2]).toBeNull(); expect(cues[6]).toBeNull();
    expect(cues[3]).toEqual({ time: 120, name: 'Cue 4' });
    expect(cues[5]?.name).toHaveLength(80);
  });

  it('removes an all-empty entry and never stores invalid duration data', () => {
    const storage = memoryStorage();
    const cues = emptyCues(); cues[0] = { time: 1, name: 'One' };
    saveAppleMusicCues(track, 10, cues, storage);
    expect(saveAppleMusicCues(track, 0, cues, storage)).toBe(false);
    expect(loadAppleMusicCues(track, NaN, storage)).toEqual(emptyCues());
    expect(saveAppleMusicCues(track, 10, emptyCues(), storage)).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('tolerates malformed JSON, missing storage and quota failures', () => {
    const storage = memoryStorage();
    storage.setItem(appleMusicCueKey(track), '{bad json');
    expect(loadAppleMusicCues(track, 10, storage)).toEqual(emptyCues());
    const broken: StorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadAppleMusicCues(track, 10, broken)).toEqual(emptyCues());
    expect(loadAppleMusicCues(track, 10, null)).toEqual(emptyCues());
    const cues = emptyCues(); cues[0] = { time: 1, name: 'One' };
    expect(saveAppleMusicCues(track, 10, cues, broken)).toBe(false);
    expect(saveAppleMusicCues(track, 10, cues, null)).toBe(false);
  });
});
