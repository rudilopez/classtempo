import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMediaSession, setHandlers } from '../platform/mediaSession';
import { bindSpotifyMediaSession, type SpotifyMediaSessionControls } from './mediaSession';

function fakeSession(unsupported: MediaSessionAction[] = []) {
  const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
  return {
    handlers,
    metadata: { title: 'Spotify song' } as unknown,
    playbackState: 'playing',
    setPositionState: vi.fn(),
    setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
      if (unsupported.includes(action)) throw new TypeError('Unsupported action');
      handlers.set(action, handler);
    },
  };
}

describe('Spotify active-source Media Session controls', () => {
  let ms: ReturnType<typeof fakeSession>;
  let active: boolean;
  let controls: SpotifyMediaSessionControls;
  beforeEach(() => {
    ms = fakeSession(); active = true;
    vi.stubGlobal('navigator', { mediaSession: ms });
    controls = { isActive: () => active, play: vi.fn(), pause: vi.fn(), seek: vi.fn(), restart: vi.fn() };
  });
  afterEach(() => { clearMediaSession(); vi.unstubAllGlobals(); });

  it('routes active actions and omits Next and seek-skip commands for a single track', () => {
    const cleanup = bindSpotifyMediaSession(controls);
    ms.handlers.get('play')?.({ action: 'play' });
    ms.handlers.get('pause')?.({ action: 'pause' });
    ms.handlers.get('stop')?.({ action: 'stop' });
    ms.handlers.get('previoustrack')?.({ action: 'previoustrack' });
    ms.handlers.get('seekto')?.({ action: 'seekto', seekTime: 42.5 });
    expect(controls.play).toHaveBeenCalledOnce(); expect(controls.pause).toHaveBeenCalledTimes(2);
    expect(controls.restart).toHaveBeenCalledOnce(); expect(controls.seek).toHaveBeenCalledExactlyOnceWith(42.5);
    expect(ms.handlers.get('nexttrack')).toBeNull();
    expect(ms.handlers.get('seekbackward')).toBeNull(); expect(ms.handlers.get('seekforward')).toBeNull();
    cleanup();
  });

  it('checks source activity at dispatch so old OS actions cannot revive inactive Spotify', () => {
    const cleanup = bindSpotifyMediaSession(controls);
    const old = new Map(ms.handlers);
    active = false;
    for (const action of ['play', 'pause', 'stop', 'previoustrack', 'seekto'] as const) {
      old.get(action)?.({ action, seekTime: 10 });
    }
    expect(controls.play).not.toHaveBeenCalled(); expect(controls.pause).not.toHaveBeenCalled();
    expect(controls.seek).not.toHaveBeenCalled(); expect(controls.restart).not.toHaveBeenCalled();
    cleanup();
  });

  it('clears supported controls and invalidates queued callbacks when cleaned up', () => {
    const cleanup = bindSpotifyMediaSession(controls);
    const oldPlay = ms.handlers.get('play'); const oldSeek = ms.handlers.get('seekto');
    cleanup();
    expect([...ms.handlers.values()].every((handler) => handler === null)).toBe(true);
    expect(ms.metadata).toBeNull(); expect(ms.playbackState).toBe('none');
    expect(ms.setPositionState).toHaveBeenCalledWith();
    oldPlay?.({ action: 'play' }); oldSeek?.({ action: 'seekto', seekTime: 10 });
    expect(controls.play).not.toHaveBeenCalled(); expect(controls.seek).not.toHaveBeenCalled();
    // Repeating old cleanup must not erase the provider that took over next.
    const otherPlay = vi.fn(); setHandlers({ play: otherPlay }); cleanup();
    expect(ms.handlers.get('play')).toBe(otherPlay);
  });

  it('rejects malformed seek positions and accepts zero', () => {
    const cleanup = bindSpotifyMediaSession(controls);
    const seek = ms.handlers.get('seekto');
    for (const seekTime of [undefined, null, '10', NaN, Infinity, -1]) {
      seek?.({ action: 'seekto', seekTime } as MediaSessionActionDetails);
    }
    expect(controls.seek).not.toHaveBeenCalled();
    seek?.({ action: 'seekto', seekTime: 0 }); expect(controls.seek).toHaveBeenCalledExactlyOnceWith(0);
    cleanup();
  });

  it('keeps supported actions usable when some browser actions are unavailable', () => {
    ms = fakeSession(['stop', 'seekto']); vi.stubGlobal('navigator', { mediaSession: ms });
    const cleanup = bindSpotifyMediaSession(controls);
    ms.handlers.get('play')?.({ action: 'play' }); expect(controls.play).toHaveBeenCalledOnce();
    expect(() => cleanup()).not.toThrow();
    expect([...ms.handlers.values()].every((handler) => handler === null)).toBe(true);
  });

  it('degrades safely when Media Session is unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(() => { const cleanup = bindSpotifyMediaSession(controls); cleanup(); }).not.toThrow();
    expect(controls.play).not.toHaveBeenCalled();
  });
});
