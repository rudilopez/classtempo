import { describe, expect, it } from 'vitest';
import { nextCueTime, previousCueTime } from './cueNavigation';

/** Pad order deliberately differs from time order, with empty pads in between. */
const CUES: (number | null)[] = [30, null, 10, 60, null, 45, null, null];

describe('previousCueTime', () => {
  it('returns 0 when there are no cues', () => {
    expect(previousCueTime([], 50)).toBe(0);
    expect(previousCueTime([null, null], 50)).toBe(0);
  });

  it('returns 0 before the first cue', () => {
    expect(previousCueTime(CUES, 5)).toBe(0);
    expect(previousCueTime(CUES, 0)).toBe(0);
  });

  it('restarts the current section when more than the threshold into it', () => {
    expect(previousCueTime(CUES, 35)).toBe(30);
    expect(previousCueTime(CUES, 50)).toBe(45);
    expect(previousCueTime(CUES, 500)).toBe(60);
  });

  it('goes to the cue before when within the threshold of the current cue', () => {
    expect(previousCueTime(CUES, 31)).toBe(10);
    expect(previousCueTime(CUES, 46.5)).toBe(30);
    expect(previousCueTime(CUES, 61)).toBe(45);
  });

  it('treats a playhead exactly on a cue as at that cue', () => {
    expect(previousCueTime(CUES, 30)).toBe(10);
    expect(previousCueTime(CUES, 10)).toBe(0);
  });

  it('needs strictly more than the threshold to restart the section', () => {
    expect(previousCueTime(CUES, 32)).toBe(10);
    expect(previousCueTime(CUES, 32.001)).toBe(30);
  });

  it('honours a custom threshold', () => {
    expect(previousCueTime(CUES, 35, 10)).toBe(10);
    expect(previousCueTime(CUES, 30.5, 0)).toBe(30);
  });

  it('returns 0 when within the threshold of the first cue', () => {
    expect(previousCueTime(CUES, 11)).toBe(0);
    expect(previousCueTime([0], 1)).toBe(0);
  });

  it('skips pads that share a time', () => {
    expect(previousCueTime([20, 10, 20, null], 21)).toBe(10);
    expect(previousCueTime([20, 20], 21)).toBe(0);
  });

  it('ignores non-finite cue times and positions', () => {
    expect(previousCueTime([NaN, 10, Infinity, -Infinity], 15)).toBe(10);
    expect(previousCueTime(CUES, NaN)).toBe(0);
  });

  it('does not modify the input', () => {
    const cues = [...CUES];
    previousCueTime(cues, 50);
    expect(cues).toEqual(CUES);
  });
});

describe('nextCueTime', () => {
  it('returns null when there are no cues', () => {
    expect(nextCueTime([], 0)).toBeNull();
    expect(nextCueTime([null, null], 0)).toBeNull();
  });

  it('returns the earliest cue after the playhead, whatever the pad order', () => {
    expect(nextCueTime(CUES, 0)).toBe(10);
    expect(nextCueTime(CUES, 12)).toBe(30);
    expect(nextCueTime(CUES, 31)).toBe(45);
    expect(nextCueTime(CUES, 50)).toBe(60);
  });

  it('returns null after the last cue', () => {
    expect(nextCueTime(CUES, 61)).toBeNull();
    expect(nextCueTime(CUES, 60)).toBeNull();
  });

  it('skips a cue the playhead is on or just past', () => {
    expect(nextCueTime(CUES, 30)).toBe(45);
    expect(nextCueTime(CUES, 29.96)).toBe(45);
    expect(nextCueTime(CUES, 29.94)).toBe(30);
  });

  it('honours a custom epsilon', () => {
    expect(nextCueTime(CUES, 29.96, 0)).toBe(30);
    expect(nextCueTime(CUES, 25, 6)).toBe(45);
  });

  it('includes a cue at 0 from before the start', () => {
    expect(nextCueTime([0, 5], -1)).toBe(0);
  });

  it('ignores non-finite cue times and positions', () => {
    expect(nextCueTime([NaN, Infinity, 20], 0)).toBe(20);
    expect(nextCueTime(CUES, NaN)).toBeNull();
  });
});
