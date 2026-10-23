import { describe, expect, it } from 'vitest';
import { commitPracticeDraft, practiceTimeInput, type PracticeDraft } from './draft';
import { defaultPracticeSettings, MIN_SECTION_SECONDS, type PracticeSettings } from './settings';

function draft(settings: Partial<PracticeSettings> = {}): PracticeDraft {
  return {
    settings: { ...defaultPracticeSettings(), mode: 'repeat', tempo: .75, delaySeconds: 3, ...settings },
    sectionId: null,
    name: 'Turn pattern',
    start: '20',
    end: '32.5',
  };
}

describe('committing the visible practice range', () => {
  it('creates a repeat section directly from Start or Save without a separate Add step', () => {
    const result = commitPracticeDraft(draft(), 120, () => 'new-section');
    expect(result).toEqual({ settings: {
      ...defaultPracticeSettings(), tempo: .75, delaySeconds: 3, mode: 'repeat',
      sections: [{ id: 'new-section', name: 'Turn pattern', start: 20, end: 32.5 }],
      selectedSectionId: 'new-section',
    } });
  });

  it('updates the selected range and keeps other saved sections and repeat options', () => {
    const value = draft({
      sections: [{ id: 'one', name: 'Old', start: 0, end: 10 }, { id: 'two', name: 'Other', start: 40, end: 60 }],
      selectedSectionId: 'one', repetitions: 4, gapSeconds: 2,
    });
    value.sectionId = 'one';
    const result = commitPracticeDraft(value, 120, () => 'unused');
    expect(result).toMatchObject({ settings: { selectedSectionId: 'one', repetitions: 4, gapSeconds: 2, sections: [
      { id: 'one', name: 'Turn pattern', start: 20, end: 32.5 }, { id: 'two', name: 'Other', start: 40, end: 60 },
    ] } });
  });

  it('saves the exact fractional track end and a valid minimum-length section at that end', () => {
    const duration = 6.006;
    const start = duration - MIN_SECTION_SECONDS;
    const result = commitPracticeDraft({
      ...draft(), start: practiceTimeInput(start), end: practiceTimeInput(duration),
    }, duration, () => 'final-pattern');
    expect(result).toMatchObject({ settings: { sections: [{ start, end: duration }] } });
    expect(commitPracticeDraft({ ...draft(), start: '0', end: '6.01' }, duration, () => 'invalid'))
      .toMatchObject({ field: 'end' });
  });

  it('preserves precise cue and saved-section bounds instead of rounding a valid range shorter', () => {
    const start = 5.7559;
    const end = 6.0059;
    const result = commitPracticeDraft({
      ...draft(), start: practiceTimeInput(start), end: practiceTimeInput(end),
    }, 6.006, () => 'cue-pattern');
    expect(result).toMatchObject({ settings: { sections: [{ start, end }] } });
  });

  it.each([
    { start: '', end: '30', field: 'start' },
    { start: 'NaN', end: '30', field: 'start' },
    { start: '-1', end: '30', field: 'start' },
    { start: '120', end: '120', field: 'start' },
    { start: '20', end: '', field: 'end' },
    { start: '20', end: '19', field: 'end' },
    { start: '20', end: '20.1', field: 'end' },
    { start: '20', end: '121', field: 'end' },
  ])('rejects invalid bounds $start–$end instead of silently saving old bounds', ({ start, end, field }) => {
    expect(commitPracticeDraft({ ...draft(), start, end }, 120, () => 'id')).toMatchObject({ field, error: expect.any(String) });
  });

  it('respects explicit full-track mode without requiring an unused range', () => {
    const value = { ...draft({ mode: 'off' }), start: '', end: '' };
    expect(commitPracticeDraft(value, 120, () => 'unused')).toEqual({ settings: value.settings });
  });

  it('prevents a new draft from silently replacing one of the maximum saved sections', () => {
    const sections = Array.from({ length: 12 }, (_, index) => ({ id: String(index), name: String(index), start: index, end: index + 1 }));
    expect(commitPracticeDraft(draft({ sections }), 120, () => 'new')).toMatchObject({ field: 'section' });
  });
});
