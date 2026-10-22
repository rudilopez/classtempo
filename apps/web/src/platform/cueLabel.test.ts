import { describe, expect, it } from 'vitest';
import { cueSection, lockScreenLine, NO_CUES_LINE, type NamedCue } from './cueLabel';

const intro: NamedCue = { time: 0, name: 'Intro' };
const verse: NamedCue = { time: 12, name: 'Verse' };
const chorus: NamedCue = { time: 30, name: 'Chorus' };
const bridge: NamedCue = { time: 60, name: 'Bridge' };

/** Pads deliberately out of time order, with empty pads in between. */
const pads: (NamedCue | null)[] = [chorus, null, verse, bridge, null, null, null, null];

describe('cueSection', () => {
  it('finds the section in unordered pads', () => {
    expect(cueSection(pads, 20)).toEqual({ current: verse, next: chorus });
    expect(cueSection(pads, 45)).toEqual({ current: chorus, next: bridge });
  });

  it('is before the first cue', () => {
    expect(cueSection(pads, 5)).toEqual({ current: null, next: verse });
  });

  it('is after the last cue', () => {
    expect(cueSection(pads, 90)).toEqual({ current: bridge, next: null });
  });

  it('counts a cue at (or a hair past) the playhead as current, so a launched cue is never "next"', () => {
    expect(cueSection(pads, 30)).toEqual({ current: chorus, next: bridge });
    expect(cueSection(pads, 29.98)).toEqual({ current: chorus, next: bridge });
    expect(cueSection(pads, 29.9)).toEqual({ current: verse, next: chorus });
  });

  it('breaks ties by pad order', () => {
    const a: NamedCue = { time: 30, name: 'A' };
    const b: NamedCue = { time: 30, name: 'B' };
    expect(cueSection([a, b], 40).current).toBe(a);
    expect(cueSection([b, a], 40).current).toBe(b);
    expect(cueSection([a, b], 10).next).toBe(a);
    expect(cueSection([b, a], 10).next).toBe(b);
  });

  it('ignores empty pads and invalid times', () => {
    const broken: (NamedCue | null)[] = [null, { time: NaN, name: 'x' }, { time: Infinity, name: 'y' }, intro, null];
    expect(cueSection(broken, 3)).toEqual({ current: intro, next: null });
    expect(cueSection([null, null], 3)).toEqual({ current: null, next: null });
    expect(cueSection([], 3)).toEqual({ current: null, next: null });
  });

  it('has no section for a non-finite playhead', () => {
    expect(cueSection(pads, NaN)).toEqual({ current: null, next: null });
  });
});

describe('lockScreenLine', () => {
  it('shows the section and the next cue', () => {
    expect(lockScreenLine(cueSection(pads, 45), true)).toBe('Chorus · next: Bridge');
  });

  it('marks the last cue', () => {
    expect(lockScreenLine(cueSection([null, { time: 8, name: 'Cue 2' }], 20), true)).toBe('Cue 2 · last cue');
  });

  it('shows what comes first before the first cue', () => {
    expect(lockScreenLine(cueSection([{ time: 10, name: 'Cue 1' }], 2), true)).toBe('Before Cue 1 · next: Cue 1');
  });

  it('says when there are no cues', () => {
    expect(lockScreenLine(cueSection([null, null], 2), false)).toBe(NO_CUES_LINE);
    expect(NO_CUES_LINE).toBe('No cues yet');
    // hasCues wins even if a section was computed, and no valid cue means no cues
    expect(lockScreenLine(cueSection(pads, 45), false)).toBe(NO_CUES_LINE);
    expect(lockScreenLine({ current: null, next: null }, true)).toBe(NO_CUES_LINE);
  });

  it('never shows a blank name', () => {
    expect(lockScreenLine({ current: { time: 0, name: '  ' }, next: null }, true)).toBe('Cue · last cue');
  });
});
