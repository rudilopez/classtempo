import { describe, expect, it } from 'vitest';
import { emptyCues, type CueSlots, type StorageLike } from '../dancer/cueStore';
import { loadYouTubeCues, saveYouTubeCues, youtubeCueKey } from './cues';

const id = 'M7lc1UVf-VE';
function storage() {
  const values = new Map<string, string>();
  const target: StorageLike = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
  return { values, target };
}
describe('YouTube cue identity and persistence', () => {
  it('keeps eight per-video slots independent from local/Apple/Spotify keys', () => {
    const { values, target } = storage();
    values.set('classtempo.spotify.cues.track.other', 'keep');
    const cues = emptyCues(); cues[0] = { time: 12, name: 'Chorus' };
    expect(saveYouTubeCues(id, 100, cues, target)).toBe(true);
    expect(loadYouTubeCues(id, 100, target)).toEqual(cues);
    expect(loadYouTubeCues('abcdefghijk', 100, target)).toEqual(emptyCues());
    expect(values.get('classtempo.spotify.cues.track.other')).toBe('keep');
  });
  it('restores unknown-duration cues before the first Play, then clamps to actual metadata', () => {
    const { target } = storage(); const cues = emptyCues(); cues[2] = { time: 125, name: 'Bridge' };
    expect(saveYouTubeCues(id, 0, cues, target)).toBe(true);
    expect(loadYouTubeCues(id, 0, target)[2]?.time).toBe(125);
    expect(loadYouTubeCues(id, 100, target)[2]?.time).toBe(100);
  });
  it('normalizes untrusted data and bounds label/slot count', () => {
    const { target, values } = storage();
    values.set(youtubeCueKey(id), JSON.stringify([{ time: 1000, name: '\n' + 'a'.repeat(80) }, { time: -1, name: 'No' }, { time: '2', name: 'No' }, { time: 2, name: '' }, ...Array(12).fill({ time: 3, name: 'extra' })]));
    const cues = loadYouTubeCues(id, 100, target);
    expect(cues).toHaveLength(8); expect(cues[0]).toEqual({ time: 100, name: 'a'.repeat(40) });
    expect(cues[1]).toBeNull(); expect(cues[2]).toBeNull(); expect(cues[3]?.name).toBe('Cue 4');
    expect(saveYouTubeCues(id, 100, [{ time: NaN, name: 'No' }, { time: Infinity, name: 'No' }] as CueSlots, target)).toBe(true);
    expect(loadYouTubeCues(id, 100, target)).toEqual(emptyCues());
  });
  it('handles corrupt, blocked and unavailable storage without affecting playback', () => {
    const { target, values } = storage(); values.set(youtubeCueKey(id), '{broken');
    expect(loadYouTubeCues(id, 100, target)).toEqual(emptyCues());
    const blocked = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Full'); }, removeItem() { throw new Error('Blocked'); } };
    expect(loadYouTubeCues(id, 100, blocked)).toEqual(emptyCues());
    expect(saveYouTubeCues(id, 100, emptyCues(), blocked)).toBe(false);
    expect(saveYouTubeCues(id, 100, emptyCues(), null)).toBe(false);
    expect(saveYouTubeCues('../bad', 100, emptyCues(), target)).toBe(false);
    expect(saveYouTubeCues(id, NaN, emptyCues(), target)).toBe(false);
  });
  it('removes empty cues without erasing another video', () => {
    const { target, values } = storage(); values.set(youtubeCueKey(id), '[1]'); values.set(youtubeCueKey('abcdefghijk'), '[2]');
    expect(saveYouTubeCues(id, 100, emptyCues(), target)).toBe(true);
    expect(values.has(youtubeCueKey(id))).toBe(false); expect(values.has(youtubeCueKey('abcdefghijk'))).toBe(true);
  });
});
