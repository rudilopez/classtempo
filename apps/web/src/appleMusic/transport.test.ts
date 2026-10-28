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

  it('keeps tempo opt-in and rejects unsupported trial rates without changing playback', () => {
    const music = instance();
    const ordinary = createAppleMusicTransport(music);
    expect(ordinary.requestedRate).toBe(1);
    expect(() => ordinary.setTempoRate(0.85)).toThrow('listening trial');
    expect(music.playbackRate).toBe(0.75);
    ordinary.setTempoRate(1);
    expect(music.playbackRate).toBe(1);
    const trial = createAppleMusicTransport(music, { tempoTrial: true });
    for (const rate of [0, 0.9, 2, NaN, Infinity]) {
      expect(() => trial.setTempoRate(rate)).toThrow('available tempo');
    }
    expect(trial.requestedRate).toBe(1);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
  });

  it.each([0.7, 0.85, 1, 1.15, 1.3])('sets trial rate %s while paused without playing', (rate) => {
    const music = instance();
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(rate);
    expect(transport.requestedRate).toBe(rate);
    expect(music.playbackRate).toBe(rate);
    expect(music.isPlaying).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
  });

  it('applies tempo before explicit Play and restores the latest request after async Play resets it', async () => {
    const music = instance();
    const pending = deferred();
    music.play.mockImplementation(() => {
      expect(music.playbackRate).toBe(0.7);
      return pending.promise;
    });
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const starting = transport.play();
    expect(music.play).toHaveBeenCalledOnce();
    transport.setTempoRate(1.15);
    music.playbackRate = 1; // MusicKit's asynchronous native start resets speed.
    pending.resolve();
    await starting;
    expect(music.playbackRate).toBe(1.15);
    expect(transport.requestedRate).toBe(1.15);
  });

  it('restores the requested trial rate after synchronous Play resets it', () => {
    const music = instance();
    music.play.mockImplementation(() => { music.playbackRate = 1; });
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.85);
    transport.play();
    expect(music.playbackRate).toBe(0.85);
    expect(music.play).toHaveBeenCalledOnce();
  });

  it.each([true, false])('preserves tempo and playing=%s through a cue', async (playing) => {
    const music = instance();
    music.isPlaying = playing;
    music.seekToTime.mockImplementation(async () => { music.playbackRate = 1; });
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(1.3);
    await transport.seek(40, track);
    expect(music.playbackRate).toBe(1.3);
    expect(transport.requestedRate).toBe(1.3);
    expect(music.isPlaying).toBe(playing);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.pause).not.toHaveBeenCalled();
  });

  it('keeps a fresh paused cue offset and tempo through native queue preparation', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const queue = deferred();
    music.setQueue.mockReturnValueOnce(queue.promise);
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const choosing = transport.seek(40, track);
    transport.setTempoRate(0.85);
    music.playbackRate = 1;
    queue.resolve();
    await choosing;
    expect(music.setQueue).toHaveBeenCalledExactlyOnceWith({ song: track.id, startPlaying: false, startTime: 40 });
    expect(transport.preparedPosition).toBe(40);
    expect(transport.requestedRate).toBe(0.85);
    expect(music.playbackRate).toBe(0.85);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.isPlaying).toBe(false);
  });

  it.each(['pause', 'cancel', 'dispose'] as const)('does not restore tempo or resume after %s interrupts pending Play', async (action) => {
    const music = instance();
    const pending = deferred();
    music.play.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const starting = transport.play();
    transport[action]();
    expect(transport.requestedRate).toBe(action === 'pause' ? 0.7 : 1);
    music.playbackRate = 1;
    pending.resolve();
    await starting;
    expect(music.playbackRate).toBe(1);
    expect(music.pause).toHaveBeenCalledTimes(2);
    expect(music.play).toHaveBeenCalledOnce();
  });

  it('does not restore an old track tempo after selecting and playing a new track', async () => {
    const music = instance();
    const pending = deferred();
    music.play.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const oldPlay = transport.play();
    transport.cancel(); // The player cancels transport before a new selection.
    expect(transport.requestedRate).toBe(1);
    expect(music.playbackRate).toBe(1);
    await music.setQueue({ song: 'new-track', startPlaying: false });
    transport.setTempoRate(1.15);
    transport.play();
    pending.resolve();
    await oldPlay;
    expect(music.playbackRate).toBe(1.15);
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('does not let an old adapter restore tempo over a new adapter', async () => {
    const music = instance();
    const pending = deferred();
    music.play.mockReturnValueOnce(pending.promise);
    const old = createAppleMusicTransport(music, { tempoTrial: true });
    old.setTempoRate(0.7);
    const starting = old.play();
    old.dispose();
    const next = createAppleMusicTransport(music, { tempoTrial: true });
    next.setTempoRate(1.3);
    next.play();
    pending.resolve();
    await starting;
    expect(music.playbackRate).toBe(1.3);
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('does not restore tempo from a cancelled seek over a newer selection', async () => {
    const music = instance();
    const pending = deferred();
    music.seekToTime.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const seeking = transport.seek(20, track);
    const rejected = expect(seeking).rejects.toThrow('cancelled');
    transport.cancel();
    transport.setTempoRate(1.15);
    pending.resolve();
    await rejected;
    expect(music.playbackRate).toBe(1.15);
    expect(transport.requestedRate).toBe(1.15);
    expect(transport.preparedPosition).toBeNull();
  });

  it('handles SDK rate failures without exposing details or starting audio', () => {
    const music = instance();
    Object.defineProperty(music, 'playbackRate', { get: () => 1, set: () => { throw new Error('private provider details'); } });
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    expect(() => transport.setTempoRate(0.7)).toThrow('Apple Music could not change tempo. Try again at 100%.');
    expect(transport.requestedRate).toBe(1);
    expect(music.play).not.toHaveBeenCalled();
    expect(() => transport.cancel()).not.toThrow();
  });

  it('does not let a rejected old Play revoke the intent of a newer Play', async () => {
    const music = instance();
    const pending = deferred();
    music.play.mockReturnValueOnce(pending.promise);
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    const oldPlay = transport.play();
    const rejected = expect(oldPlay).rejects.toThrow('failed');
    transport.pause();
    transport.setTempoRate(0.85);
    transport.play();
    music.isPlaying = true;
    pending.reject(new Error('failed'));
    await rejected;
    await transport.seek(40, track);
    expect(music.playbackRate).toBe(0.85);
    expect(music.pause).toHaveBeenCalledOnce();
  });

  it('ends the trial paused at the prepared fresh cue and allows normal-speed Play there', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(0.7);
    await transport.seek(40, track);
    transport.endTempoTrial();
    expect(transport.preparedPosition).toBe(40);
    expect(transport.requestedRate).toBe(1);
    expect(music.playbackRate).toBe(1);
    expect(music.isPlaying).toBe(false);
    expect(music.play).not.toHaveBeenCalled();
    expect(music.setQueue).toHaveBeenCalledExactlyOnceWith({ song: track.id, startPlaying: false, startTime: 40 });
    music.play.mockImplementation(() => {
      music.isPlaying = true;
      music.currentPlaybackDuration = 120;
      music.currentPlaybackTime = 40;
    });
    transport.play();
    expect(music.playbackRate).toBe(1);
    expect(music.currentPlaybackTime).toBe(40);
    expect(transport.preparedPosition).toBeNull();
  });

  it('ending the trial invalidates a pending Play and keeps the prepared cue paused', async () => {
    const music = instance();
    music.currentPlaybackDuration = 0;
    const pending = deferred();
    music.play.mockReturnValueOnce(pending.promise);
    music.pause.mockImplementation(() => { music.isPlaying = false; });
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    await transport.seek(40, track);
    transport.setTempoRate(0.85);
    const starting = transport.play();
    transport.endTempoTrial();
    expect(transport.preparedPosition).toBe(40);
    music.isPlaying = true; // A late native start must not revive the audition.
    pending.resolve();
    await starting;
    expect(music.isPlaying).toBe(false);
    expect(music.pause).toHaveBeenCalledTimes(2);
    expect(music.playbackRate).toBe(1);
    expect(transport.requestedRate).toBe(1);
    expect(transport.preparedPosition).toBe(40);
  });

  it('ending the trial permanently revokes non-original rates on the same transport', () => {
    const music = instance();
    const transport = createAppleMusicTransport(music, { tempoTrial: true });
    transport.setTempoRate(1.3);
    transport.endTempoTrial();
    expect(() => transport.setTempoRate(0.7)).toThrow('listening trial');
    transport.cancel();
    expect(() => transport.setTempoRate(1.15)).toThrow('listening trial');
    transport.setTempoRate(1);
    transport.play();
    expect(transport.requestedRate).toBe(1);
    expect(music.playbackRate).toBe(1);
  });
});
