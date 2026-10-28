import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicTrack } from './client';
import { appleMusicCueKey } from './cues';
import { saveCleanRestart, takeCleanRestart, type CleanRestartStorage } from './cleanRestart';

function storage(): CleanRestartStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const song: MusicTrack = { id: '123456', type: 'songs', name: 'A song', artist: 'An artist' };
const now = 1_000_000;
const key = 'classtempo.apple-music.clean-restart.v1';
const saved = (track: unknown = song, savedAt = now): string => JSON.stringify({ version: 1, savedAt, track });

afterEach(() => { vi.unstubAllGlobals(); });

describe('Apple Music clean restart metadata', () => {
  it('saves and consumes the selected song once without changing unrelated session data', () => {
    const target = storage();
    target.setItem('unrelated', 'keep');
    const track = { ...song, album: 'Album', artworkUrl: 'https://example.com/cover.jpg', durationSeconds: 245.3 };
    expect(saveCleanRestart(track, target, now)).toBe(true);
    expect(takeCleanRestart(target, now + 2000)).toEqual(track);
    expect(takeCleanRestart(target, now + 2000)).toBeNull();
    expect(target.values).toEqual(new Map([['unrelated', 'keep']]));
  });

  it('preserves library song provider identity and its existing cue storage key', () => {
    const target = storage();
    const track: MusicTrack = { ...song, id: 'i.Abc_123-xyz', type: 'library-songs' };
    saveCleanRestart(track, target, now);
    const restored = takeCleanRestart(target, now)!;
    expect(restored.id).toBe(track.id);
    expect(restored.type).toBe(track.type);
    expect(appleMusicCueKey(restored)).toBe(appleMusicCueKey(track));
  });

  it('selects only metadata when saving and reading, without reading unknown private fields', () => {
    const target = storage();
    const track = { ...song, playbackRate: 0.75, audio: 'private audio' };
    const privateField = vi.fn(() => { throw new Error('Never read a token'); });
    Object.defineProperty(track, 'musicUserToken', { get: privateField, enumerable: true });
    expect(saveCleanRestart(track, target, now)).toBe(true);
    expect(privateField).not.toHaveBeenCalled();
    expect(JSON.parse(target.values.get(key)!)).toEqual({ version: 1, savedAt: now, track: song });
    target.setItem(key, JSON.stringify({ version: 1, savedAt: now, developerToken: 'private', track: { ...song, token: 'private', audio: 'private', playbackRate: 0.75 } }));
    expect(takeCleanRestart(target, now)).toEqual(song);
  });

  it.each([now - 300_000, now - 300_001, now + 1, -1])('discards stale/future/invalid saved timestamp %s', (timestamp) => {
    const target = storage();
    target.setItem(key, saved(song, timestamp));
    expect(takeCleanRestart(target, now)).toBeNull();
    expect(target.values.has(key)).toBe(false);
  });

  it.each([Number.NaN, Infinity, -1])('rejects invalid current time %s', (timestamp) => {
    const target = storage();
    expect(saveCleanRestart(song, target, timestamp)).toBe(false);
    target.setItem(key, saved());
    expect(takeCleanRestart(target, timestamp)).toBeNull();
    expect(target.values.has(key)).toBe(false);
  });

  it.each([
    '{broken', 'null', '[]', '{}', 'x'.repeat(5001),
    JSON.stringify({ version: 2, savedAt: now, track: song }),
    JSON.stringify({ version: 1, savedAt: '1000000', track: song }),
  ])('consumes malformed or unsupported records without returning them', (raw) => {
    const target = storage();
    target.setItem(key, raw);
    expect(takeCleanRestart(target, now)).toBeNull();
    expect(target.values.has(key)).toBe(false);
  });

  it.each([
    { id: '' }, { id: ' id-with-space ' }, { id: 'x'.repeat(257) }, { id: 'bad\u0000id' },
    { type: 'albums' }, { name: ' ' }, { name: 'x'.repeat(501) }, { artist: null },
    { album: 'x'.repeat(501) }, { durationSeconds: 0 }, { durationSeconds: -1 }, { durationSeconds: '245' },
    { artworkUrl: 'http://example.com/cover.jpg' }, { artworkUrl: 'https://user:secret@example.com/cover.jpg' },
    { artworkUrl: 'javascript:alert(1)' }, { artworkUrl: 'https://example.com/' + 'x'.repeat(2000) },
  ])('rejects invalid track fields on both save and consumption: %j', (change) => {
    const target = storage();
    const invalid = { ...song, ...change };
    expect(saveCleanRestart(invalid as MusicTrack, target, now)).toBe(false);
    target.setItem(key, saved(invalid));
    expect(takeCleanRestart(target, now)).toBeNull();
    expect(target.values.has(key)).toBe(false);
  });

  it('rejects nonfinite optional duration and clears an older handoff before a refused replacement', () => {
    const target = storage();
    saveCleanRestart(song, target, now);
    expect(saveCleanRestart({ ...song, durationSeconds: Infinity }, target, now)).toBe(false);
    expect(takeCleanRestart(target, now)).toBeNull();
    expect(saveCleanRestart({ ...song, durationSeconds: Number.NaN }, target, now)).toBe(false);
  });

  it('fails closed when session storage is absent or its methods throw', () => {
    expect(saveCleanRestart(song, null, now)).toBe(false);
    expect(takeCleanRestart(null, now)).toBeNull();
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const target = storage();
      target.setItem(key, saved());
      target[method] = () => { throw new Error('Blocked'); };
      if (method !== 'getItem') expect(saveCleanRestart(song, target, now)).toBe(false);
      if (method !== 'setItem') expect(takeCleanRestart(target, now)).toBeNull();
    }
  });

  it('accesses default sessionStorage only when requested and catches a blocked getter', () => {
    const getter = vi.fn(() => { throw new Error('Storage denied'); });
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: getter });
    try {
      expect(saveCleanRestart(song, storage(), now)).toBe(true);
      expect(getter).not.toHaveBeenCalled();
      expect(saveCleanRestart(song, undefined, now)).toBe(false);
      expect(takeCleanRestart(undefined, now)).toBeNull();
      expect(getter).toHaveBeenCalledTimes(2);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
      else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
  });
});
