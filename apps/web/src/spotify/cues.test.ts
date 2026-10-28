import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSpotifyCues, loadSpotifyCues, saveSpotifyCues, spotifyCueKey } from './cues';
import { emptyCues } from '../dancer/cueStore';

function storage() {
  const data = new Map<string, string>();
  return { data, get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
afterEach(() => vi.unstubAllGlobals());
describe('Spotify cue persistence', () => {
  it('stores normalized cue data separately from local and Apple cues', () => {
    const target = storage(); const track = { id: 'track' }; const cues = emptyCues(); cues[1] = { time: 300, name: 'Verse\n' };
    expect(saveSpotifyCues(track, 120, cues, target)).toBe(true);
    expect(spotifyCueKey(track)).toBe('classtempo.spotify.cues.track.track');
    expect(loadSpotifyCues(track, 120, target)[1]).toEqual({ time: 120, name: 'Verse' });
    expect([...target.data.values()][0]).not.toContain('token');
  });
  it('clears only Spotify cues on explicit disconnect', () => {
    const target = storage(); vi.stubGlobal('localStorage', target);
    target.setItem('mixdeck.dancer.cues.song', 'local'); target.setItem('classtempo.apple-music.cues.songs.1', 'apple');
    target.setItem(spotifyCueKey({ id: '1' }), 'spotify'); target.setItem(spotifyCueKey({ id: '2' }), 'spotify');
    clearSpotifyCues();
    expect([...target.data.values()]).toEqual(['local', 'apple']);
  });
  it('handles corrupt/unavailable storage and invalid cue values', () => {
    const target = storage(); target.setItem(spotifyCueKey({ id: 'x' }), 'bad-json');
    expect(loadSpotifyCues({ id: 'x' }, 120, target)).toEqual(emptyCues());
    expect(saveSpotifyCues({ id: 'x' }, 0, emptyCues(), target)).toBe(false);
    expect(saveSpotifyCues({ id: 'x' }, 120, emptyCues(), null)).toBe(false);
  });
});
