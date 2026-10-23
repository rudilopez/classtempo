import { describe, expect, it } from 'vitest';
import { formatTime } from './types';

describe('cue and practice time display', () => {
  it('keeps exact tenth-second cue boundaries accurate', () => {
    expect(formatTime(1.2)).toBe('0:01.2');
    expect(formatTime(61.2)).toBe('1:01.2');
    expect(formatTime(59.9)).toBe('0:59.9');
  });
  it('does not display the next second before playback reaches it', () => {
    expect(formatTime(59.999)).toBe('0:59.9');
    expect(formatTime(60)).toBe('1:00.0');
  });
  it('keeps missing or negative media time readable', () => {
    for (const value of [-1, NaN, Infinity]) expect(formatTime(value)).toBe('0:00.0');
  });
});
