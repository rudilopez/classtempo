import { describe, expect, it } from 'vitest';
import { defaultPracticeSettings, practiceKey } from '../practice/settings';
import { practiceClassEntry, savedClassPractices } from './classPreparation';
import type { LibraryMedia } from './store';

const media: LibraryMedia = { id: 'saved', name: 'Turn | music.m4a', type: 'audio/mp4', size: 1000,
  lastModified: 0, kind: 'audio', addedAt: 0, openedAt: 0, available: true };

function storage(values: Record<string, string>): Pick<Storage, 'length' | 'key' | 'getItem'> {
  return { length: Object.keys(values).length, key: (index) => Object.keys(values)[index] ?? null,
    getItem: (key) => values[key] ?? null };
}

describe('class preparation from saved named practices', () => {
  it('finds non-current media and activates each practice own playback snapshot without changing its defaults', () => {
    const settings = { ...defaultPracticeSettings(), tempo: 1, sections: [{ id: 'turn', name: 'Slow turns', start: 10, end: 20,
      playback: { tempo: 0.7, mode: 'repeat' as const, repetitions: 3, gapSeconds: 2, delaySeconds: 1, videoMirrored: false, videoZoom: 1 } }],
      selectedSectionId: 'turn' };
    const saved = JSON.stringify(settings);
    const source = storage({ [practiceKey(media.name, 60)]: saved });
    const choices = savedClassPractices([media], source);
    expect(choices).toHaveLength(1);
    expect(choices[0]?.settings).toMatchObject({ tempo: 0.7, mode: 'repeat', repetitions: 3, gapSeconds: 2, selectedSectionId: 'turn' });
    expect(source.getItem(practiceKey(media.name, 60))).toBe(saved);
    const first = practiceClassEntry(choices[0]!, 'first');
    const again = practiceClassEntry(choices[0]!, 'again');
    expect(first).toMatchObject({ id: 'first', mediaId: media.id, name: 'Slow turns', practiceDuration: 60 });
    first.practice!.sections[0]!.start = 15;
    expect(again.practice?.sections[0]?.start).toBe(10);
    expect(choices[0]?.settings.sections[0]?.start).toBe(10);
  });

  it('ignores corrupt or unrelated records and unavailable copies, without hiding other practices', () => {
    const settings = { ...defaultPracticeSettings(), sections: [{ id: 'a', name: 'Basics', start: 1, end: 3 }] };
    const source = storage({
      [practiceKey(media.name, 50)]: '{broken',
      [practiceKey(media.name, 60)]: JSON.stringify(settings),
      [practiceKey(media.name + ' extra', 60)]: JSON.stringify(settings),
      [`mixdeck.practice.${media.name}|Infinity`]: JSON.stringify(settings),
      unrelated: JSON.stringify(settings),
    });
    const choices = savedClassPractices([media, { ...media, id: 'missing', available: false }], source);
    expect(choices.map((choice) => [choice.mediaId, choice.duration, choice.settings.mode])).toEqual([['saved', 60, 'repeat']]);
    expect(savedClassPractices([media], null)).toEqual([]);
    expect(savedClassPractices([media], { length: 1, key: () => { throw new Error('blocked'); }, getItem: () => null })).toEqual([]);
  });
});
