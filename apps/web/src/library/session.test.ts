import { afterEach, describe, expect, it, vi } from 'vitest';
import { librarySessionReducer, readLibraryDestination, rememberLibraryDestination, type LibrarySession } from './session';

afterEach(() => vi.unstubAllGlobals());

describe('Library playback ownership', () => {
  const playing: LibrarySession = { source: 'apple-music', destination: 'apple-music', open: false };
  it('browses every destination without switching the loaded player', () => {
    let state = playing;
    for (const destination of ['files', 'classes', 'youtube', 'spotify', 'apple-music'] as const) {
      state = librarySessionReducer(state, { type: 'open', destination });
      expect(state).toEqual({ source: 'apple-music', destination, open: true });
    }
  });
  it('returns to the same player and reopens the last browsing destination', () => {
    const browse = librarySessionReducer(playing, { type: 'open', destination: 'classes' });
    const closed = librarySessionReducer(browse, { type: 'close' });
    expect(closed).toEqual({ source: 'apple-music', destination: 'classes', open: false });
    expect(librarySessionReducer(closed, { type: 'open' })).toEqual({ ...closed, open: true });
  });
  it('transfers ownership only on selection, closing the browser for provider songs', () => {
    expect(librarySessionReducer({ ...playing, destination: 'spotify', open: true }, { type: 'select', source: 'spotify' }))
      .toEqual({ source: 'spotify', destination: 'spotify', open: false });
  });
  it('keeps local selection open until decoding and class preflight complete', () => {
    const next = librarySessionReducer({ ...playing, destination: 'classes', open: true }, { type: 'select', source: 'player', keepLibrary: true });
    expect(next).toEqual({ source: 'player', destination: 'classes', open: true });
    expect(librarySessionReducer(next, { type: 'close' }).source).toBe('player');
  });
});

describe('Library destination memory', () => {
  it('remembers the selected destination without touching playback or authentication', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    rememberLibraryDestination('classes');
    expect(readLibraryDestination(false)).toBe('classes');
    expect([...values.keys()]).toEqual(['classtempo.library.destination.v1']);
  });
  it('cannot reveal Spotify from a saved destination', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'spotify' });
    expect(readLibraryDestination(false)).toBe('files');
    expect(readLibraryDestination(true)).toBe('spotify');
  });
  it('ignores invalid values and blocked storage', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'unknown' });
    expect(readLibraryDestination(true)).toBe('files');
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readLibraryDestination(true)).toBe('files');
    expect(() => rememberLibraryDestination('classes')).not.toThrow();
  });
});
