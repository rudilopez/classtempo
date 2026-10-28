import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicKitInstance, MusicTrack } from './client';

function instance() {
  return {
    isAuthorized: true as boolean, isPlaying: false, playbackState: 0,
    currentPlaybackTime: 0, currentPlaybackDuration: 0, playbackRate: 1,
    nowPlayingItem: null as unknown,
    authorize: vi.fn(async () => undefined), unauthorize: vi.fn(async () => undefined),
    setQueue: vi.fn(async (_options: { song: string; startPlaying: boolean }): Promise<unknown> => undefined),
    play: vi.fn(), pause: vi.fn(), stop: vi.fn(), seekToTime: vi.fn(async (_seconds: number) => undefined),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    api: { music: vi.fn(async (_path: string, _parameters?: Readonly<Record<string, string | number>>): Promise<unknown> => ({ data: { data: [] } })) },
  } satisfies MusicKitInstance;
}

class Script extends EventTarget {
  src = '';
  async = false;
  removed = false;
  remove(): void { this.removed = true; }
}

class Document extends EventTarget {
  scripts: Script[] = [];
  head = { appendChild: vi.fn((script: Script) => { this.scripts.push(script); return script; }) };
  createElement = vi.fn((_tag: string) => new Script());
}

function resource(id = '123', type = 'songs') {
  return { id, type, attributes: { name: 'Test song', artistName: 'Test artist', albumName: 'Test album',
    durationInMillis: 123_456, artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.{f}' } } };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('MusicKit lazy loading', () => {
  it('does not contact Apple on import and shares one SDK/configuration across callers', async () => {
    const doc = new Document(); vi.stubGlobal('document', doc);
    const client = await import('./client');
    expect(doc.scripts).toHaveLength(0);
    const first = client.loadMusicKit('public-developer-token');
    const second = client.loadMusicKit('public-developer-token');
    expect(first).toBe(second);
    expect(doc.scripts).toHaveLength(1);
    expect(doc.scripts[0]?.src).toBe('https://js-cdn.music.apple.com/musickit/v3/musickit.js');
    expect(doc.scripts[0]?.async).toBe(true);
    const music = instance();
    const sdk = { configure: vi.fn(async () => music), getInstance: vi.fn(() => music) };
    vi.stubGlobal('MusicKit', sdk);
    doc.dispatchEvent(new Event('musickitloaded'));
    await expect(first).resolves.toBe(music);
    expect(sdk.configure).toHaveBeenCalledExactlyOnceWith({ developerToken: 'public-developer-token', app: { name: 'ClassTempo', build: '1' }, bitrate: 256 });
    expect(music.authorize).not.toHaveBeenCalled();
    expect(music.play).not.toHaveBeenCalled();
    expect(music.setQueue).not.toHaveBeenCalled();
  });

  it('reuses an already available SDK and checks getInstance when configure returns void', async () => {
    const music = instance();
    const sdk = { configure: vi.fn(async () => undefined), getInstance: vi.fn(() => music) };
    vi.stubGlobal('MusicKit', sdk);
    const { loadMusicKit } = await import('./client');
    await expect(loadMusicKit('token')).resolves.toBe(music);
    expect(sdk.getInstance).toHaveBeenCalledOnce();
    await expect(loadMusicKit('different-token')).rejects.toThrow('Reload ClassTempo');
    expect(sdk.configure).toHaveBeenCalledOnce();
  });

  it('times out a missing SDK and ignores its stale error after a successful retry', async () => {
    vi.useFakeTimers();
    const doc = new Document(); vi.stubGlobal('document', doc);
    const { loadMusicKit } = await import('./client');
    const first = loadMusicKit('token');
    const rejected = expect(first).rejects.toThrow('Apple Music could not start');
    await vi.advanceTimersByTimeAsync(20_001);
    await rejected;
    expect(doc.scripts[0]?.removed).toBe(true);
    const second = loadMusicKit('token');
    expect(doc.scripts).toHaveLength(2);
    const music = instance();
    vi.stubGlobal('MusicKit', { configure: vi.fn(async () => music), getInstance: () => music });
    doc.scripts[0]?.dispatchEvent(new Event('error'));
    doc.dispatchEvent(new Event('musickitloaded'));
    await expect(second).resolves.toBe(music);
    expect(doc.scripts[1]?.removed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a failed script load without retaining its listeners or script', async () => {
    const doc = new Document(); vi.stubGlobal('document', doc);
    const { loadMusicKit } = await import('./client');
    const first = loadMusicKit('token');
    const rejected = expect(first).rejects.toThrow('Apple Music could not start');
    doc.scripts[0]?.dispatchEvent(new Event('error'));
    await rejected;
    expect(doc.scripts[0]?.removed).toBe(true);
    const retry = loadMusicKit('token');
    const music = instance();
    vi.stubGlobal('MusicKit', { configure: async () => music, getInstance: () => music });
    doc.dispatchEvent(new Event('musickitloaded'));
    await expect(retry).resolves.toBe(music);
    expect(doc.scripts).toHaveLength(2);
  });

  it('does not overlap a retry with a timed-out configuration still mutating the SDK', async () => {
    vi.useFakeTimers();
    let completeOld: ((music: MusicKitInstance) => void) | undefined;
    const old = new Promise<MusicKitInstance>((resolve) => { completeOld = resolve; });
    const next = instance();
    const sdk = { configure: vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(next), getInstance: () => next };
    vi.stubGlobal('MusicKit', sdk);
    const { loadMusicKit } = await import('./client');
    const pending = loadMusicKit('token');
    const rejection = expect(pending).rejects.toThrow('Apple Music could not start');
    await vi.advanceTimersByTimeAsync(20_001);
    await rejection;
    await expect(loadMusicKit('token')).rejects.toThrow('setup is still finishing');
    expect(sdk.configure).toHaveBeenCalledOnce();
    completeOld?.(instance());
    await Promise.resolve();
    const retry = loadMusicKit('token');
    await expect(retry).resolves.toBe(next);
    await expect(loadMusicKit('token')).resolves.toBe(next);
  });

  it('never returns a configuration error containing tokens and allows retry', async () => {
    const music = instance();
    const sdk = { configure: vi.fn().mockRejectedValueOnce(new Error('Authorization: Bearer SECRET_TOKEN')).mockResolvedValueOnce(music), getInstance: () => music };
    vi.stubGlobal('MusicKit', sdk);
    const { loadMusicKit } = await import('./client');
    await expect(loadMusicKit('token')).rejects.toThrow(/^Apple Music could not start\./);
    await expect(loadMusicKit('token')).resolves.toBe(music);
  });

  it('rejects absent settings and malformed SDK instances before exposing controls', async () => {
    const { loadMusicKit } = await import('./client');
    await expect(loadMusicKit(' ')).rejects.toThrow('not configured');
    vi.stubGlobal('MusicKit', { configure: async () => ({ isAuthorized: true }), getInstance: () => null });
    await expect(loadMusicKit('token')).rejects.toThrow('could not start');
  });
});

describe('Apple Music lists', () => {
  it('uses the v3 catalog endpoint and safely parses only songs', async () => {
    const music = instance();
    music.api.music.mockResolvedValue({ data: { results: { songs: { data: [null, resource(), resource('video', 'music-videos')] } } } });
    const { searchSongs } = await import('./client');
    expect(await searchSongs(music, '  bachata  ')).toEqual([{ id: '123', type: 'songs', name: 'Test song', artist: 'Test artist',
      album: 'Test album', durationSeconds: 123.456, artworkUrl: 'https://is1-ssl.mzstatic.com/image/300x300bb.jpg' }]);
    expect(music.api.music).toHaveBeenCalledWith('/v1/catalog/{{storefrontId}}/search', { term: 'bachata', types: 'songs', limit: 25 });
    expect(music.authorize).not.toHaveBeenCalled();
  });

  it('does not issue empty searches and distinguishes empty results from malformed responses', async () => {
    const music = instance();
    const { searchSongs } = await import('./client');
    expect(await searchSongs(music, ' ')).toEqual([]);
    expect(music.api.music).not.toHaveBeenCalled();
    music.api.music.mockResolvedValueOnce({ data: { results: {} } });
    expect(await searchSongs(music, 'empty')).toEqual([]);
    for (const response of [null, {}, { data: null }, { data: { results: [] } }, { data: { results: { songs: {} } } }]) {
      music.api.music.mockResolvedValueOnce(response);
      await expect(searchSongs(music, 'test')).rejects.toThrow('Apple Music');
    }
  });

  it('reads the first library page without authorizing implicitly, mutating the library or substituting catalog IDs', async () => {
    const music = instance();
    const library = resource('i.abc123', 'library-songs');
    music.api.music.mockResolvedValue({ data: { data: [library], next: '/v1/me/library/songs?offset=25' } });
    const { librarySongs } = await import('./client');
    expect((await librarySongs(music))[0]?.id).toBe('i.abc123');
    expect(music.api.music).toHaveBeenCalledExactlyOnceWith('/v1/me/library/songs', { limit: 25 });
    expect(music.authorize).not.toHaveBeenCalled();
    music.isAuthorized = false;
    await expect(librarySongs(music)).rejects.toThrow('Connect to Apple Music');
    expect(music.api.music).toHaveBeenCalledOnce();
  });

  it('reads playlists and encodes the selected identifier as a single URL segment', async () => {
    const music = instance();
    music.api.music.mockResolvedValueOnce({ data: { data: [null, { id: 'p.123', type: 'library-playlists', attributes: {
      name: 'Practice', description: { standard: 'Warmup songs' },
    } }] } }).mockResolvedValueOnce({ data: { data: [resource('i.one', 'library-songs')] } });
    const { libraryPlaylists, playlistSongs } = await import('./client');
    expect(await libraryPlaylists(music)).toEqual([{ id: 'p.123', name: 'Practice', description: 'Warmup songs' }]);
    expect(await playlistSongs(music, 'p.123/?next=x')).toHaveLength(1);
    expect(music.api.music).toHaveBeenLastCalledWith('/v1/me/library/playlists/p.123%2F%3Fnext%3Dx/tracks', { limit: 25 });
    await expect(playlistSongs(music, '')).rejects.toThrow('Choose an Apple Music playlist');
  });

  it('bounds list size and removes unsafe artwork URLs and invalid timing', async () => {
    const music = instance();
    const row = resource(); row.attributes.artwork.url = 'javascript:alert(1)'; row.attributes.durationInMillis = Infinity;
    music.api.music.mockResolvedValue({ data: { data: Array.from({ length: 30 }, () => row) } });
    const { librarySongs } = await import('./client');
    const songs = await librarySongs(music);
    expect(songs).toHaveLength(25);
    expect(songs[0]).not.toHaveProperty('artworkUrl');
    expect(songs[0]).not.toHaveProperty('durationSeconds');
  });

  it('sanitizes API rejection and error envelopes instead of showing raw authorization data', async () => {
    const music = instance();
    const { librarySongs } = await import('./client');
    music.api.music.mockRejectedValueOnce(new Error('Music-User-Token: PRIVATE'));
    await expect(librarySongs(music)).rejects.toThrow(/^Apple Music could not load this list\./);
    music.api.music.mockResolvedValueOnce({ data: { errors: [{ detail: 'SECRET' }] } });
    await expect(librarySongs(music)).rejects.toThrow(/^Apple Music could not load this list\./);
  });
});

describe('Apple Music playback boundary', () => {
  it('restores original speed before synchronously starting playback from the gesture', async () => {
    const music = instance();
    music.playbackRate = 0.75;
    let rateAtPlay: number | undefined;
    music.play.mockImplementation(() => { rateAtPlay = music.playbackRate; return Promise.resolve(); });
    const { playAtOriginalSpeed } = await import('./client');
    const playing = playAtOriginalSpeed(music);
    expect(rateAtPlay).toBe(1);
    expect(music.play).toHaveBeenCalledOnce();
    await playing;
  });

  it('does not start playback if original speed cannot be restored', async () => {
    const music = instance();
    Object.defineProperty(music, 'playbackRate', { get: () => 1.1, set: () => { throw new Error('Rate unavailable'); } });
    const { playAtOriginalSpeed } = await import('./client');
    expect(() => playAtOriginalSpeed(music)).toThrow();
    expect(music.play).not.toHaveBeenCalled();
  });

  it('loads a single library or catalog song paused and never begins playback', async () => {
    const music = instance();
    music.playbackRate = 1.1;
    music.setQueue.mockImplementation(async () => { expect(music.playbackRate).toBe(1); });
    const { loadSelected } = await import('./client');
    const track: MusicTrack = { id: 'i.abc123', type: 'library-songs', name: 'Song', artist: 'Artist' };
    await loadSelected(music, track);
    expect(music.pause).toHaveBeenCalledOnce();
    expect(music.setQueue).toHaveBeenCalledExactlyOnceWith({ song: 'i.abc123', startPlaying: false });
    expect(music.play).not.toHaveBeenCalled();
    music.setQueue.mockRejectedValueOnce(new Error('token SECRET'));
    await expect(loadSelected(music, track)).rejects.toThrow(/^This song could not load from Apple Music\./);
  });

  it('keeps a timed-out native queue operation locked until it actually settles', async () => {
    vi.useFakeTimers();
    const music = instance();
    let finish: (() => void) | undefined;
    music.setQueue.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const { loadSelected } = await import('./client');
    const firstTrack: MusicTrack = { id: 'one', type: 'songs', name: 'First', artist: 'Artist' };
    const secondTrack: MusicTrack = { ...firstTrack, id: 'two' };
    const first = loadSelected(music, firstTrack);
    const rejection = expect(first).rejects.toThrow('This song could not load');
    await expect(loadSelected(music, secondTrack)).rejects.toThrow('still loading a song');
    await vi.advanceTimersByTimeAsync(20_001);
    await rejection;
    await expect(loadSelected(music, secondTrack)).rejects.toThrow('still loading a song');
    expect(music.setQueue).toHaveBeenCalledOnce();
    finish?.();
    await Promise.resolve(); await Promise.resolve();
    await loadSelected(music, secondTrack);
    expect(music.setQueue).toHaveBeenLastCalledWith({ song: 'two', startPlaying: false });
    expect(music.play).not.toHaveBeenCalled();
  });

  it('returns only safe playback display data, including the SDK singular song type', async () => {
    const music = instance();
    music.nowPlayingItem = { ...resource('i.abc', 'song'), secretToken: 'PRIVATE' };
    music.currentPlaybackTime = NaN; music.currentPlaybackDuration = Infinity; music.playbackRate = -1; music.playbackState = NaN;
    Object.assign(music, { musicUserToken: 'PRIVATE' });
    const { snapshot } = await import('./client');
    const state = snapshot(music);
    expect(state).toMatchObject({ isAuthorized: true, isPlaying: false, currentTime: 0, duration: 0, rate: 1, playbackState: null,
      track: { id: 'i.abc', type: 'library-songs', name: 'Test song' } });
    expect(JSON.stringify(state)).not.toContain('PRIVATE');
    music.nowPlayingItem = null;
    expect(snapshot(music).track).toBeNull();
  });
});
