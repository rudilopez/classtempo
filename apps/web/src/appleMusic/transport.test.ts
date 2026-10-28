import { describe, expect, it, vi } from 'vitest';
import type { MusicKitInstance } from './client';
import { createAppleMusicTransport } from './transport';

function instance() {
  return {
    isAuthorized: true as boolean, isPlaying: false as boolean, playbackState: 0,
    currentPlaybackTime: 0, currentPlaybackDuration: 120, playbackRate: 0.75,
    nowPlayingItem: null as unknown,
    authorize: vi.fn(async () => undefined), unauthorize: vi.fn(async () => undefined),
    setQueue: vi.fn<MusicKitInstance['setQueue']>(async () => undefined), play: vi.fn<() => void | Promise<unknown>>(),
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
const track = { id: 'catalog-song', durationSeconds: 120 };

describe('Apple Music transport', () => {
  it('resets speed and invokes explicit Play synchronously in the initiating gesture', () => {
    const music = instance();
    music.play.mockImplementation(() => { expect(music.playbackRate).toBe(1); });
    createAppleMusicTransport(music).play();
    expect(music.play).toHaveBeenCalledOnce();
  });

  it.each([true, false])('preserves playing=%s while moving to an initialized cue', async (playing) => {
    const music = instance();
    music.isPlaying = playing;
    const transport = createAppleMusicTransport(music);
    await transport.seek(40, track);
    expect(music.seekToTime).toHaveBeenCalledExactlyOnceWith(40);
    expect(music.playbackRate).toBe(1);
    expect(music.isPlaying).toBe(playing);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
    expect(music.setQueue).not.toHaveBeenCalled();
  });

  it('prepares a fresh paused cue without ever invoking Play or a native seek', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const transport = createAppleMusicTransport(music);
    await transport.seek(40, track);
    expect(music.setQueue).toHaveBeenCalledExactlyOnceWith({ song: track.id, startPlaying: false, startTime: 40 });
    expect(transport.preparedPosition).toBe(40);
    expect(music.currentPlaybackTime).toBe(0);
    expect(music.isPlaying).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
    expect(music.seekToTime).not.toHaveBeenCalled();
  });

  it('keeps the prepared display position until explicit Play reaches the queue offset', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    await transport.seek(40, track);
    const starting = transport.play();
    expect(music.play).toHaveBeenCalledOnce();
    expect(transport.preparedPosition).toBe(40);
    music.isPlaying = true;
    music.currentPlaybackDuration = 120;
    expect(transport.preparedPosition).toBe(40);
    music.currentPlaybackTime = 40;
    expect(transport.preparedPosition).toBeNull();
    music.isPlaying = false;
    expect(transport.preparedPosition).toBeNull();
    play.resolve();
    await starting;
  });

  it('replaces a prepared paused cue and clamps it using the catalog duration', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const transport = createAppleMusicTransport(music);
    await transport.seek(-3, track);
    await transport.seek(900, track);
    expect(music.setQueue.mock.calls).toEqual([
      [{ song: track.id, startPlaying: false, startTime: 0 }],
      [{ song: track.id, startPlaying: false, startTime: 120 }],
    ]);
    expect(transport.preparedPosition).toBe(120);
    expect(music.play).not.toHaveBeenCalled();
  });

  it('clamps initialized seeks and refuses invalid positions', async () => {
    const music = instance();
    const transport = createAppleMusicTransport(music);
    await transport.seek(-3);
    await transport.seek(900);
    expect(music.seekToTime.mock.calls).toEqual([[0], [120]]);
    await expect(transport.seek(NaN)).rejects.toThrow('valid position');
    expect(music.play).not.toHaveBeenCalled();
  });

  it('does not guess a fresh queue identity or duration', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const transport = createAppleMusicTransport(music);
    await expect(transport.seek(40)).rejects.toThrow('Wait for the song');
    await expect(transport.seek(40, { id: '', durationSeconds: 120 })).rejects.toThrow('Wait for the song');
    await expect(transport.seek(40, { id: track.id, durationSeconds: NaN })).rejects.toThrow('Wait for the song');
    expect(music.setQueue).not.toHaveBeenCalled();
    expect(music.play).not.toHaveBeenCalled();
  });

  it.each(['native', 'queue'] as const)('keeps the %s operation locked until it settles', async (kind) => {
    const music = instance();
    const pending = deferred();
    if (kind === 'queue') { music.currentPlaybackDuration = 0; music.setQueue.mockReturnValueOnce(pending.promise); }
    else music.seekToTime.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music);
    const first = transport.seek(20, track);
    expect(transport.seeking).toBe(true);
    await expect(transport.seek(30, track)).rejects.toThrow('still seeking');
    expect(() => transport.play()).toThrow('Tap Play');
    pending.resolve();
    await first;
    expect(transport.seeking).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
  });

  it.each(['pause', 'cancel', 'dispose'] as const)('does not restore a fresh cue position after %s', async (action) => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const queue = deferred();
    music.setQueue.mockReturnValueOnce(queue.promise);
    const transport = createAppleMusicTransport(music);
    const choosing = transport.seek(40, track);
    const rejected = expect(choosing).rejects.toThrow('cancelled');
    transport[action]();
    expect(transport.seeking).toBe(true);
    queue.resolve();
    await rejected;
    expect(transport.preparedPosition).toBeNull();
    expect(transport.seeking).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
  });

  it('clears a prepared cue when changing source', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const transport = createAppleMusicTransport(music);
    await transport.seek(40, track);
    transport.cancel();
    expect(transport.preparedPosition).toBeNull();
    expect(music.play).not.toHaveBeenCalled();
  });

  it('keeps the operation lock across disposal and remount', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const queue = deferred();
    music.setQueue.mockReturnValueOnce(queue.promise);
    const old = createAppleMusicTransport(music);
    const choosing = old.seek(40, track);
    const rejected = expect(choosing).rejects.toThrow('cancelled');
    old.dispose();
    const next = createAppleMusicTransport(music);
    await expect(next.seek(70, track)).rejects.toThrow('still seeking');
    expect(() => next.play()).toThrow('still seeking');
    queue.resolve();
    await rejected;
    await next.seek(70, track);
    expect(next.preparedPosition).toBe(70);
    expect(music.play).not.toHaveBeenCalled();
  });

  it.each(['native', 'queue'] as const)('releases a failed %s operation without starting or stopping audio', async (kind) => {
    const music = instance();
    const transport = createAppleMusicTransport(music);
    if (kind === 'queue') { music.currentPlaybackDuration = 0; music.setQueue.mockRejectedValueOnce(new Error('unavailable')); }
    else music.seekToTime.mockRejectedValueOnce(new Error('unavailable'));
    await expect(transport.seek(40, track)).rejects.toThrow('unavailable');
    expect(transport.seeking).toBe(false);
    expect(transport.preparedPosition).toBeNull();
    await transport.seek(20, track);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
  });

  it('does not apply a late queue result after lost authorization', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const queue = deferred();
    music.setQueue.mockReturnValueOnce(queue.promise);
    const transport = createAppleMusicTransport(music);
    const choosing = transport.seek(40, track);
    const rejected = expect(choosing).rejects.toThrow('Connect Apple Music');
    music.isAuthorized = false;
    queue.resolve();
    await rejected;
    expect(transport.preparedPosition).toBeNull();
    expect(music.play).not.toHaveBeenCalled();
  });

  it('does not let a pending Play revive playback after a paused cue', async () => {
    const music = instance();
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    const starting = transport.play();
    await transport.seek(40, track);
    expect(music.pause).toHaveBeenCalledOnce();
    play.resolve();
    await starting;
    expect(music.pause).toHaveBeenCalledTimes(2);
  });

  it('does not let delayed Play completion undo a later Pause', async () => {
    const music = instance();
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const transport = createAppleMusicTransport(music);
    const starting = transport.play();
    transport.pause();
    play.resolve();
    await starting;
    expect(music.pause).toHaveBeenCalledTimes(2);
  });

  it('does not let old Play completion pause a new explicit Play after remount', async () => {
    const music = instance();
    const play = deferred();
    music.play.mockReturnValueOnce(play.promise);
    const old = createAppleMusicTransport(music);
    const starting = old.play();
    old.dispose();
    const next = createAppleMusicTransport(music);
    next.play();
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
