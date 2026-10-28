import { describe, expect, it, vi } from 'vitest';
import { createSpotifyTransport } from './transport';
import type { MusicTrack, SpotifyPlayer, SpotifySnapshot } from './client';

const track: MusicTrack = { id: '4iV5W9uYEdYUVa79Axb7Rh', uri: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh', name: 'Song', artist: 'Artist', durationSeconds: 120, externalUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh' };
function fixture() {
  const state: SpotifySnapshot = { ready: true, playing: false, position: 0, duration: 120, trackId: null };
  const player = { activate: vi.fn(), start: vi.fn(async (_track: MusicTrack, _seconds: number) => {}), pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), seek: vi.fn(async (_seconds: number) => {}), dispose: vi.fn(), snapshot: () => ({ ...state }) } satisfies SpotifyPlayer;
  return { player, state, transport: createSpotifyTransport(player) };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
describe('Spotify transport intent', () => {
  it('prepares paused cues without starting or seeking the native track', async () => {
    const { player, transport } = fixture(); await transport.seek(40, false);
    expect(transport.preparedPosition).toBe(40); expect(player.start).not.toHaveBeenCalled(); expect(player.seek).not.toHaveBeenCalled();
    const playing = transport.play(track);
    expect(player.activate).toHaveBeenCalledOnce(); expect(player.start).toHaveBeenCalledWith(track, 40);
    await playing;
  });
  it('seeks a playing song without issuing another Play', async () => {
    const { player, state, transport } = fixture(); state.trackId = track.id; state.playing = true;
    await transport.seek(20, true); expect(player.seek).toHaveBeenCalledWith(20);
    expect(player.start).not.toHaveBeenCalled(); expect(player.resume).not.toHaveBeenCalled(); expect(player.pause).not.toHaveBeenCalled();
  });
  it('normal Play resumes an already initialized selected song', async () => {
    const { player, state, transport } = fixture(); await transport.play(track);
    state.trackId = track.id; state.playing = true; expect(transport.preparedPosition).toBeNull();
    await transport.pause(); state.playing = false;
    await transport.play(track); expect(player.start).toHaveBeenCalledOnce(); expect(player.resume).toHaveBeenCalledOnce();
  });
  it('cancel removes old cue/identity and a new song starts from zero', async () => {
    const { player, state, transport } = fixture(); await transport.seek(40, false); transport.cancel();
    state.trackId = track.id;
    expect(transport.preparedPosition).toBeNull(); await transport.play(track);
    expect(player.start).toHaveBeenCalledWith(track, 0); expect(player.resume).not.toHaveBeenCalled();
  });
  it('Pause defeats a pending Play; the late completion does not resume', async () => {
    const { player, transport } = fixture(); const late = deferred(); player.start.mockReturnValueOnce(late.promise);
    const starting = transport.play(track); expect(transport.pending).toBe(true);
    await transport.pause(); late.resolve(); await starting;
    expect(player.pause.mock.calls.length).toBeGreaterThanOrEqual(2); expect(player.resume).not.toHaveBeenCalled(); expect(transport.pending).toBe(false);
  });
  it('a paused cue revokes a pending Play and retains the new prepared offset', async () => {
    const { player, transport } = fixture(); const late = deferred(); player.start.mockReturnValueOnce(late.promise);
    const starting = transport.play(track); await transport.seek(35, false); late.resolve(); await starting;
    expect(transport.preparedPosition).toBe(35); expect(player.resume).not.toHaveBeenCalled();
  });
  it('source teardown disposes the owned player and defeats late playback', async () => {
    const { player, transport } = fixture(); const late = deferred(); player.start.mockReturnValueOnce(late.promise);
    const starting = transport.play(track); transport.dispose(); late.resolve(); await starting;
    expect(player.dispose).toHaveBeenCalledOnce(); expect(player.pause.mock.calls.length).toBeGreaterThanOrEqual(2);
    await expect(transport.play(track)).rejects.toThrow('closed');
  });
  it('rejects overlapping native operations and invalid cue positions', async () => {
    const { player, transport } = fixture(); const late = deferred(); player.seek.mockReturnValueOnce(late.promise);
    const seeking = transport.seek(10, true);
    await expect(transport.play(track)).rejects.toThrow('Wait'); await expect(transport.seek(NaN, false)).rejects.toThrow('valid');
    late.resolve(); await seeking;
  });
});
