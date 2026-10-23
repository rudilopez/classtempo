import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../dancer/cueStore';
import { parseBackup } from '../library/store';
import { activatePracticeSection, defaultPracticeSettings, loadPracticeSettings, normalizePracticeSettings, practiceKey, savePracticeSettings, type PracticePlayback, type PracticeSettings } from './settings';

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

const slowPlayback: PracticePlayback = { tempo: .7, mode: 'repeat', repetitions: 3, gapSeconds: 2, delaySeconds: 4, videoMirrored: true, videoZoom: 1.5 };
const normalPlayback: PracticePlayback = { tempo: 1, mode: 'once', repetitions: null, gapSeconds: 0, delaySeconds: 0, videoMirrored: false, videoZoom: 1 };

function namedPractices(): PracticeSettings {
  return {
    ...defaultPracticeSettings(),
    sections: [
      { id: 'slow', name: 'Learn the turn', start: 2, end: 10, playback: slowPlayback },
      { id: 'normal', name: 'Dance the chorus', start: 15, end: 30, playback: normalPlayback },
    ],
    selectedSectionId: 'slow',
  };
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

  it('restores each named practice independently after storage and after stopping practice', () => {
    const storage = memoryStorage();
    const settings = namedPractices();
    expect(savePracticeSettings('lesson.mp4', 60, settings, storage)).toBe(true);
    const loaded = loadPracticeSettings('lesson.mp4', 60, storage);
    expect(loaded).toEqual(settings);
    const slow = activatePracticeSection(loaded, 'slow');
    expect(slow).toMatchObject({ ...slowPlayback, selectedSectionId: 'slow' });
    const normal = activatePracticeSection({ ...slow, mode: 'off' }, 'normal');
    expect(normal).toMatchObject({ ...normalPlayback, selectedSectionId: 'normal' });
    expect(activatePracticeSection(normal, 'slow')).toMatchObject(slowPlayback);
    expect(normal.sections).toEqual(settings.sections);
    expect(settings.mode).toBe('off');
    expect(activatePracticeSection(loaded, 'missing')).toBe(loaded);
  });

  it('preserves old range-only records and uses current playback options when selecting them', () => {
    const storage = memoryStorage();
    const legacy = { ...defaultPracticeSettings(), tempo: .85, gapSeconds: 3, delaySeconds: 5, repetitions: 4, videoMirrored: true, sections: [{ id: 'old', name: 'Original turn', start: 1, end: 5 }], selectedSectionId: 'old' };
    storage.setItem(practiceKey('lesson.mp4', 60), JSON.stringify(legacy));
    const loaded = loadPracticeSettings('lesson.mp4', 60, storage);
    expect(loaded).toEqual(legacy);
    expect(loaded.sections[0]).not.toHaveProperty('playback');
    expect(activatePracticeSection(loaded, 'old')).toEqual({ ...legacy, mode: 'repeat' });
    expect(activatePracticeSection({ ...loaded, mode: 'once' }, 'old').mode).toBe('once');
  });

  it('clamps a malformed imported snapshot and rejects non-object snapshots', () => {
    const settings = normalizePracticeSettings({ sections: [
      { id: 'safe', start: 0, end: 10, playback: { tempo: 5, mode: 'off', repetitions: -4, gapSeconds: -1, delaySeconds: Infinity, videoMirrored: 'true', videoZoom: 9 } },
      { id: 'array', start: 0, end: 10, playback: [] },
      { id: 'null', start: 0, end: 10, playback: null },
      { id: 'string', start: 0, end: 10, playback: 'repeat' },
      { id: 'missing', start: 0, end: 10, playback: { tempo: NaN, repetitions: '100', gapSeconds: '3' } },
    ] }, 60);
    expect(settings.sections[0]).toMatchObject({ name: 'Practice 1', playback: { tempo: 1.5, mode: 'repeat', repetitions: 1, gapSeconds: 0, delaySeconds: 0, videoMirrored: false, videoZoom: 2 } });
    for (const section of settings.sections.slice(1, 4)) expect(section).not.toHaveProperty('playback');
    expect(settings.sections[4]?.playback).toEqual({ ...normalPlayback, mode: 'repeat', repetitions: 2 });
    expect(activatePracticeSection(settings, 'safe')).toMatchObject({ tempo: 1.5, mode: 'repeat', repetitions: 1 });
  });

  it('retains named presets in class backup normalization and per-track backup records', () => {
    const settings = namedPractices();
    const key = practiceKey('lesson.mp4', 60);
    const restored = parseBackup(JSON.stringify({
      format: 'classtempo-library', version: 1, exportedAt: '2026-10-23',
      media: [{ id: 'lesson', name: 'lesson.mp4', type: 'video/mp4', kind: 'video', size: 100, lastModified: 1, addedAt: 1, openedAt: 1, available: true }],
      classes: [{ id: 'class', name: 'Tuesday', updatedAt: 1, entries: [{ id: 'exercise', mediaId: 'lesson', practice: settings, practiceDuration: 60 }] }],
      settings: { [key]: JSON.stringify(settings) },
    }));
    const exercise = restored.classes[0]!.entries[0]!.practice!;
    expect(exercise).toEqual(settings);
    expect(activatePracticeSection(exercise, 'slow')).toMatchObject(slowPlayback);
    const storage = memoryStorage();
    storage.setItem(key, restored.settings[key]!);
    expect(loadPracticeSettings('lesson.mp4', 60, storage)).toEqual(settings);
  });
});
