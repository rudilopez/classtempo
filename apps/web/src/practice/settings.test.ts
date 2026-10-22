import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../dancer/cueStore';
import { defaultPracticeSettings, loadPracticeSettings, normalizePracticeSettings, practiceKey, savePracticeSettings } from './settings';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

describe('per-track practice settings', () => {
  it('round trips tempo, named sections, repeats, and video framing without touching cue keys', () => {
    const storage = memoryStorage();
    storage.setItem('mixdeck.dancer.cues.song.mp3|60.00', 'existing cues');
    const settings = { ...defaultPracticeSettings(), tempo: .8, sections: [{ id: 'turn', name: 'Turn pattern', start: 12.3, end: 20.6 }], selectedSectionId: 'turn', mode: 'repeat' as const, repetitions: 4, gapSeconds: 3, delaySeconds: 5, videoMirrored: true, videoZoom: 1.5 };
    expect(practiceKey('song.mp3', 60)).toBe('mixdeck.practice.song.mp3|60.00');
    expect(savePracticeSettings('song.mp3', 60, settings, storage)).toBe(true);
    expect(loadPracticeSettings('song.mp3', 60, storage)).toEqual(settings);
    expect(storage.getItem('mixdeck.dancer.cues.song.mp3|60.00')).toBe('existing cues');
    expect(loadPracticeSettings('other.mp3', 60, storage)).toEqual(defaultPracticeSettings());
  });

  it('rejects malformed sections and clamps imported settings to safe bounds', () => {
    const settings = normalizePracticeSettings({ tempo: 10, delaySeconds: Infinity, gapSeconds: -1, repetitions: 500, videoZoom: 9, mode: 'repeat', selectedSectionId: 'missing', sections: [
      { id: 'valid', name: '  Chorus  ', start: -5, end: 90 },
      { id: 'backwards', name: 'No', start: 30, end: 10 },
      { id: 'invalid', name: 'No', start: NaN, end: 10 },
      { id: 'tiny', name: 'No', start: 5, end: 5.1 },
      { id: 'valid', name: 'Duplicate', start: 3, end: 20 },
    ] }, 60);
    expect(settings).toMatchObject({ tempo: 1.5, delaySeconds: 0, gapSeconds: 0, repetitions: 100, videoZoom: 2, selectedSectionId: 'valid', mode: 'repeat' });
    expect(settings.sections).toEqual([{ id: 'valid', name: 'Chorus', start: 0, end: 60 }]);
  });

  it('falls back safely for missing, corrupt, or blocked local storage', () => {
    const storage = memoryStorage();
    storage.setItem(practiceKey('song', 60), '{bad json');
    expect(loadPracticeSettings('song', 60, storage)).toEqual(defaultPracticeSettings());
    expect(loadPracticeSettings('song', 60, null)).toEqual(defaultPracticeSettings());
    const broken: StorageLike = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Blocked'); }, removeItem: () => undefined };
    expect(loadPracticeSettings('song', 60, broken)).toEqual(defaultPracticeSettings());
    expect(savePracticeSettings('song', 60, defaultPracticeSettings(), broken)).toBe(false);
    expect(savePracticeSettings('song', 60, defaultPracticeSettings(), null)).toBe(false);
  });

  it('disables sections when no valid selection survives validation', () => {
    expect(normalizePracticeSettings({ mode: 'repeat', selectedSectionId: 'missing' }, 0)).toMatchObject({ mode: 'off', selectedSectionId: null });
  });
});
