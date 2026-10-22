import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMediaSession,
  refreshHandlers,
  setHandlers,
  setNowPlaying,
  setNowPlayingArtist,
  setPlaybackState,
  setPosition,
} from './mediaSession';

/** Records what the helpers do to `navigator.mediaSession`. */
function fakeSession(unsupported: string[] = []) {
  const handlers = new Map<string, unknown>();
  return {
    handlers,
    metadata: null as unknown,
    playbackState: 'none',
    setPositionState: vi.fn(),
    setActionHandler(action: string, handler: unknown) {
      if (unsupported.includes(action)) throw new TypeError(`${action} not supported`);
      handlers.set(action, handler);
    },
  };
}

class FakeMetadata {
  constructor(readonly init: unknown) {}
}

describe('mediaSession helpers', () => {
  let ms: ReturnType<typeof fakeSession>;

  beforeEach(() => {
    ms = fakeSession(['stop']);
    vi.stubGlobal('navigator', { mediaSession: ms });
    vi.stubGlobal('MediaMetadata', FakeMetadata);
  });

  afterEach(() => {
    clearMediaSession(); // forgets the handlers kept for refreshHandlers
    vi.unstubAllGlobals();
  });

  it('sets metadata with the app icons as default artwork', () => {
    setNowPlaying({ title: 'Song', artist: 'Dancer mode' });
    expect(ms.metadata).toBeInstanceOf(FakeMetadata);
    expect((ms.metadata as FakeMetadata).init).toEqual({
      title: 'Song',
      artist: 'Dancer mode',
      artwork: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    });
  });

  it('sets the playback state', () => {
    setPlaybackState('playing');
    expect(ms.playbackState).toBe('playing');
  });

  it('reports only the moves into playing (WebKit starts a session there)', () => {
    expect(setPlaybackState('paused')).toBe(false);
    expect(setPlaybackState('playing')).toBe(true);
    expect(setPlaybackState('playing')).toBe(false);
    expect(setPlaybackState('paused')).toBe(false);
    expect(setPlaybackState('none')).toBe(false);
    expect(setPlaybackState('playing')).toBe(true);
  });

  it('changes only the second line of the current metadata', () => {
    setNowPlayingArtist('nothing to change yet');
    expect(ms.metadata).toBeNull();
    const metadata = { title: 'Song', artist: 'MixDeck · Dancer mode', artwork: [] };
    ms.metadata = metadata;
    setNowPlayingArtist('Chorus · next: Bridge');
    expect(ms.metadata).toBe(metadata);
    expect(metadata).toEqual({ title: 'Song', artist: 'Chorus · next: Bridge', artwork: [] });
  });

  it('re-registers the last handlers, and nothing after a clear', () => {
    refreshHandlers();
    expect(ms.handlers.size).toBe(0);
    const play = vi.fn();
    const seekto = vi.fn();
    setHandlers({ play, seekto });
    ms.handlers.clear(); // e.g. dropped by the browser
    refreshHandlers();
    expect(ms.handlers.get('play')).toBe(play);
    expect(ms.handlers.get('seekto')).toBe(seekto);
    expect(ms.handlers.get('pause')).toBeNull();
    expect(ms.handlers.get('seekforward')).toBeNull();
    clearMediaSession();
    refreshHandlers();
    expect([...ms.handlers.values()].every((h) => h === null)).toBe(true);
  });

  it('passes valid positions, clamped to the track', () => {
    setPosition({ duration: 100, position: 12, rate: 0.75 });
    setPosition({ duration: 100, position: 100.2, rate: 1 });
    setPosition({ duration: 100, position: -0.1, rate: 1 });
    expect(ms.setPositionState.mock.calls).toEqual([
      [{ duration: 100, position: 12, playbackRate: 0.75 }],
      [{ duration: 100, position: 100, playbackRate: 1 }],
      [{ duration: 100, position: 0, playbackRate: 1 }],
    ]);
  });

  it('ignores invalid positions', () => {
    setPosition({ duration: 0, position: 0, rate: 1 });
    setPosition({ duration: Infinity, position: 0, rate: 1 });
    setPosition({ duration: NaN, position: 0, rate: 1 });
    setPosition({ duration: 10, position: NaN, rate: 1 });
    setPosition({ duration: 10, position: 1, rate: 0 });
    setPosition({ duration: 10, position: 1, rate: -1 });
    expect(ms.setPositionState).not.toHaveBeenCalled();
  });

  it('swallows a rejected position state', () => {
    ms.setPositionState.mockImplementation(() => {
      throw new TypeError('bad');
    });
    expect(() => setPosition({ duration: 10, position: 1, rate: 1 })).not.toThrow();
  });

  it('registers given handlers, nulls the rest and never registers seek skips', () => {
    const play = vi.fn();
    const next = vi.fn();
    setHandlers({ play, nexttrack: next, stop: vi.fn() });
    expect(ms.handlers.get('play')).toBe(play);
    expect(ms.handlers.get('nexttrack')).toBe(next);
    expect(ms.handlers.get('pause')).toBeNull();
    expect(ms.handlers.get('previoustrack')).toBeNull();
    expect(ms.handlers.get('seekto')).toBeNull();
    expect(ms.handlers.get('seekbackward')).toBeNull();
    expect(ms.handlers.get('seekforward')).toBeNull();
    expect(ms.handlers.has('stop')).toBe(false);
  });

  it('clears everything', () => {
    setNowPlaying({ title: 'Song' });
    setPlaybackState('playing');
    setHandlers({ play: vi.fn(), pause: vi.fn() });
    clearMediaSession();
    expect(ms.metadata).toBeNull();
    expect(ms.playbackState).toBe('none');
    expect([...ms.handlers.values()].every((h) => h === null)).toBe(true);
    expect(ms.setPositionState).toHaveBeenCalledWith();
  });

  it('does nothing without the API', () => {
    vi.stubGlobal('navigator', {});
    expect(() => {
      setNowPlaying({ title: 'x' });
      expect(setPlaybackState('playing')).toBe(false);
      setPosition({ duration: 1, position: 0, rate: 1 });
      setHandlers({ play: () => {} });
      refreshHandlers();
      setNowPlayingArtist('x');
      clearMediaSession();
    }).not.toThrow();
  });
});
