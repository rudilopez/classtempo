import { describe, expect, it } from 'vitest';
import { ACCEPT_MEDIA, countCues, isVideoFile } from './media';

describe('isVideoFile', () => {
  it('follows a video MIME type', () => {
    expect(isVideoFile({ name: 'routine.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'clip', type: 'video/quicktime' })).toBe(true);
    expect(isVideoFile({ name: 'clip.webm', type: 'VIDEO/WEBM' })).toBe(true);
  });

  it('keeps audio MIME types on the audio player, whatever the extension', () => {
    expect(isVideoFile({ name: 'song.mp3', type: 'audio/mpeg' })).toBe(false);
    expect(isVideoFile({ name: 'song.mp4', type: 'audio/mp4' })).toBe(false);
    expect(isVideoFile({ name: 'voice.webm', type: 'audio/webm' })).toBe(false);
  });

  it('falls back to the extension when the browser gives no type', () => {
    for (const name of ['a.mp4', 'b.MOV', 'c.m4v', 'd.webm']) expect(isVideoFile({ name, type: '' })).toBe(true);
    for (const name of ['a.mp3', 'b.m4a', 'c.wav', 'd.flac', 'e.ogg', 'mp4', 'f.mp4.txt']) expect(isVideoFile({ name, type: '' })).toBe(false);
  });

  it('accepts every extension it recognises in the picker', () => {
    for (const ext of ['.mp4', '.mov', '.m4v', '.webm', '.mp3', '.m4a', '.wav']) expect(ACCEPT_MEDIA.split(',')).toContain(ext);
    expect(ACCEPT_MEDIA.split(',')).toEqual(expect.arrayContaining(['audio/*', 'video/*']));
  });
});

describe('countCues', () => {
  it('counts set pads only', () => {
    expect(countCues([null, { time: 1, name: 'A' }, null, { time: 2, name: 'B' }])).toBe(2);
    expect(countCues([null, null])).toBe(0);
    expect(countCues([])).toBe(0);
  });
});
