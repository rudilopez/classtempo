import { describe, expect, it, vi } from 'vitest';
import type { MusicKitInstance } from './client';
import { createAppleMusicTransport } from './transport';

function instance() {
  return {
    isAuthorized: true as boolean, isPlaying: false as boolean, playbackState: 0,
    currentPlaybackTime: 0, currentPlaybackDuration: 120, playbackRate: 0.75,
    nowPlayingItem: null as unknown,
    authorize: vi.fn(async () => undefined), unauthorize: vi.fn(async () => undefined),
    setQueue: vi.fn(async () => undefined), play: vi.fn<() => void | Promise<unknown>>(),
    pause: vi.fn<() => void | Promise<unknown>>(), stop: vi.fn(), seekToTime: vi.fn(async (_seconds: number): Promise<void> => undefined),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    api: { music: vi.fn(async () => ({ data: { data: [] } })) },
  } satisfies MusicKitInstance;
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('Apple Music transport', () => {
  it('resets speed and invokes Play synchronously in the initiating gesture', () => {
    const music = instance();
    music.play.mockImplementation(() => { expect(music.playbackRate).toBe(1); });
    const transport = createAppleMusicTransport(music);
    transport.play();
    expect(music.play).toHaveBeenCalledOnce();
  });

  it('does not overlap seeks or defer Play until a seek finishes', async () => {
    const music = instance();
    const pending = deferred();
    music.seekToTime.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music);
    const first = transport.seek(20);
    expect(transport.seeking).toBe(true);
    await expect(transport.seek(30)).rejects.toThrow('still seeking');
    expect(() => transport.play()).toThrow('Tap Play');
    expect(music.seekToTime).toHaveBeenCalledExactlyOnceWith(20);
    pending.resolve();
    await first;
    expect(transport.seeking).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
  });

  it('clamps ordinary seeks to song bounds and never changes play state', async () => {
    const music = instance();
    const transport = createAppleMusicTransport(music);
    await transport.seek(-3);
    await transport.seek(900);
    expect(music.seekToTime.mock.calls).toEqual([[0], [120]]);
    expect(music.pause).not.toHaveBeenCalled();
    expect(music.play).not.toHaveBeenCalled();
    await expect(transport.seek(NaN)).rejects.toThrow('valid position');
  });

  it('launches a cue without stopping an already playing stream', async () => {
    const music = instance();
    music.isPlaying = true;
    const transport = createAppleMusicTransport(music);
    const choosing = transport.launchCue(40);
    expect(music.seekToTime).toHaveBeenCalledExactlyOnceWith(40);
    expect(transport.seeking).toBe(true);
    expect(music.playbackRate).toBe(1);
    expect(music.pause).not.toHaveBeenCalled();
    await choosing;
    expect(music.play).not.toHaveBeenCalled();
    expect(music.isPlaying).toBe(true);
  });

  it('starts a paused cue in the same gesture without waiting for the seek', async () => {
    const music = instance();
    const seek = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    music.play.mockImplementation(() => {
      expect(music.seekToTime).toHaveBeenCalledExactlyOnceWith(40);
      expect(music.playbackRate).toBe(1);
      music.isPlaying = true;
    });
    const transport = createAppleMusicTransport(music);
    const choosing = transport.launchCue(40);
    expect(music.play).toHaveBeenCalledOnce();
    expect(transport.seeking).toBe(true);
    expect(music.pause).not.toHaveBeenCalled();
    seek.resolve();
    await choosing;
    expect(music.play).toHaveBeenCalledOnce();
    expect(music.isPlaying).toBe(true);
  });

  it.each(['pause', 'cancel', 'dispose'] as const)('keeps %s final when a cue seek and Play settle later', async (action) => {
    const music = instance();
    const seek = deferred();
    const play = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    const choosing = transport.launchCue(40);
    const rejected = expect(choosing).rejects.toThrow('cancelled');
    transport[action]();
    expect(transport.seeking).toBe(true);
    expect(music.pause).toHaveBeenCalledOnce();
    seek.resolve();
    play.resolve();
    await rejected;
    expect(music.seekToTime).toHaveBeenCalledExactlyOnceWith(40);
    expect(music.play).toHaveBeenCalledOnce();
    expect(music.pause).toHaveBeenCalledTimes(2);
    expect(transport.seeking).toBe(false);
  });

  it('stops wrong-position playback when the cue seek fails after Play succeeds', async () => {
    const music = instance();
    const seek = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    const transport = createAppleMusicTransport(music);
    const choosing = transport.launchCue(40);
    const rejected = expect(choosing).rejects.toThrow('seek failed');
    expect(music.play).toHaveBeenCalledOnce();
    seek.reject(new Error('seek failed'));
    await rejected;
    expect(music.pause).toHaveBeenCalledOnce();
    expect(transport.seeking).toBe(false);
  });

  it('holds the native seek lock when cue Play fails before seeking finishes', async () => {
    const music = instance();
    const seek = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    music.play.mockRejectedValueOnce(new Error('Play refused'));
    const transport = createAppleMusicTransport(music);
    await expect(transport.launchCue(40)).rejects.toThrow('Play refused');
    expect(music.pause).toHaveBeenCalledOnce();
    expect(transport.seeking).toBe(true);
    await expect(transport.launchCue(70)).rejects.toThrow('still seeking');
    seek.resolve();
    await seek.promise;
    expect(transport.seeking).toBe(false);
  });

  it('does not let an old failed cue pause a newer explicit Play', async () => {
    const music = instance();
    const seek = deferred();
    const play = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    const choosing = transport.launchCue(40);
    const rejected = expect(choosing).rejects.toThrow('old Play failed');
    transport.cancel();
    seek.resolve();
    await seek.promise;
    transport.play();
    play.reject(new Error('old Play failed'));
    await rejected;
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('does not let a cancelled cue completion pause a new source Play after remount', async () => {
    const music = instance();
    const seek = deferred();
    const play = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    music.play.mockReturnValueOnce(play.promise);
    const old = createAppleMusicTransport(music);
    const choosing = old.launchCue(40);
    const rejected = expect(choosing).rejects.toThrow('cancelled');
    old.dispose();
    const next = createAppleMusicTransport(music);
    seek.resolve();
    await seek.promise;
    next.play();
    play.resolve();
    await rejected;
    expect(music.play).toHaveBeenCalledTimes(2);
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('does not start an invalid cue or start after a synchronous seek failure', async () => {
    const music = instance();
    const transport = createAppleMusicTransport(music);
    await expect(transport.launchCue(NaN)).rejects.toThrow('valid position');
    music.seekToTime.mockImplementationOnce(() => { throw new Error('seek unavailable'); });
    await expect(transport.launchCue(40)).rejects.toThrow('seek unavailable');
    expect(music.play).not.toHaveBeenCalled();
    expect(transport.seeking).toBe(false);
  });

  it('holds the native seek lock across disposal and remount until the actual operation settles', async () => {
    const music = instance();
    const seek = deferred();
    music.seekToTime.mockReturnValueOnce(seek.promise);
    const old = createAppleMusicTransport(music);
    const pending = old.seek(10);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    old.dispose();
    const next = createAppleMusicTransport(music);
    expect(next.seeking).toBe(true);
    await expect(next.seek(70)).rejects.toThrow('still seeking');
    expect(() => next.play()).toThrow('still seeking');
    seek.resolve();
    await rejected;
    expect(next.seeking).toBe(false);
    await next.seek(70);
    expect(music.seekToTime.mock.calls).toEqual([[10], [70]]);
  });

  it('releases the seek lock after a failure so the user can retry', async () => {
    const music = instance();
    music.seekToTime.mockRejectedValueOnce(new Error('decoder unavailable'));
    const transport = createAppleMusicTransport(music);
    await expect(transport.seek(10)).rejects.toThrow('decoder unavailable');
    expect(transport.seeking).toBe(false);
    await transport.seek(20);
    expect(music.play).not.toHaveBeenCalled();
  });

  it('does not let delayed Play completion undo a later Pause', async () => {
    const music = instance();
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    const starting = transport.play();
    transport.pause();
    expect(music.pause).toHaveBeenCalledOnce();
    play.resolve();
    await starting;
    expect(music.pause).toHaveBeenCalledTimes(2);
  });

  it('does not let an old Play completion pause a new explicit Play after remount', async () => {
    const music = instance();
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const old = createAppleMusicTransport(music);
    const starting = old.play();
    old.dispose();
    const next = createAppleMusicTransport(music);
    next.play();
    expect(music.pause).toHaveBeenCalledOnce();
    play.resolve();
    await starting;
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('refuses playback after disposal or lost authorization', async () => {
    const music = instance();
    const transport = createAppleMusicTransport(music);
    music.isAuthorized = false;
    expect(() => transport.play()).toThrow('Connect Apple Music');
    await expect(transport.seek(2)).rejects.toThrow('Connect Apple Music');
    transport.dispose();
    music.isAuthorized = true;
    expect(() => transport.play()).toThrow('player is closed');
    expect(music.play).not.toHaveBeenCalled();
  });
});
