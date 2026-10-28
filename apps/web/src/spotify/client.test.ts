import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MusicTrack, SpotifyPlayer, SpotifySnapshot } from './client';

const token = vi.hoisted(() => vi.fn(async (_signal?: AbortSignal) => 'private-access-token'));
vi.mock('./auth', () => ({ getSpotifyAccessToken: token }));
const ID = '4iV5W9uYEdYUVa79Axb7Rh';
const OTHER = '1301WleyT98MSxVHPZCA6M';
function resource(overrides: Record<string, unknown> = {}) {
  return { id: ID, type: 'track', uri: `spotify:track:${ID}`, name: 'Song', duration_ms: 120000,
    artists: [{ name: 'Artist' }], album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/art' }] },
    external_urls: { spotify: 'https://evil.example/ignored' }, ...overrides };
}
const track: MusicTrack = { id: ID, uri: `spotify:track:${ID}`, name: 'Song', artist: 'Artist', durationSeconds: 120, externalUrl: `https://open.spotify.com/track/${ID}` };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Listener = (value: unknown) => void;
class NativePlayer {
  listeners = new Map<string, Set<Listener>>();
  state: unknown = null;
  connect = vi.fn(async () => { this.emit('ready', { device_id: 'owned-device' }); return true; });
  disconnect = vi.fn();
  activateElement = vi.fn(async () => {});
  pause = vi.fn(async () => {});
  resume = vi.fn(async () => {});
  seek = vi.fn(async (_ms: number) => {});
  getCurrentState = vi.fn(async () => this.state);
  addListener(name: string, listener: Listener): boolean { const set = this.listeners.get(name) ?? new Set(); set.add(listener); this.listeners.set(name, set); return true; }
  removeListener(name: string, listener: Listener): boolean { return this.listeners.get(name)?.delete(listener) ?? false; }
  emit(name: string, value: unknown): void { for (const listener of this.listeners.get(name) ?? []) listener(value); }
}
function state(id = ID, playing = false, position = 10_000) {
  return { paused: !playing, position, duration: 120000, track_window: { current_track: { id } }, disallows: {} };
}
let native: NativePlayer;
let active: SpotifyPlayer | undefined;
let errors: ReturnType<typeof vi.fn<(message: string) => void>>;
let snapshots: SpotifySnapshot[];
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.resetModules(); token.mockReset().mockResolvedValue('private-access-token');
  native = new NativePlayer(); errors = vi.fn(); snapshots = []; active = undefined;
  vi.stubGlobal('Spotify', { Player: vi.fn(function () { return native; }) });
  fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { active?.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function create() {
  const { createSpotifyPlayer } = await import('./client');
  active = await createSpotifyPlayer((value) => snapshots.push(value), errors);
  return active;
}

describe('Spotify browsing and metadata boundary', () => {
  it('uses the bounded current search endpoint and canonical attribution', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ tracks: { items: [resource(), null, resource({ type: 'episode' }), resource({ is_local: true }), resource({ is_playable: false })] } }));
    const { searchTracks } = await import('./client');
    expect(await searchTracks(' bachata ')).toEqual([{ ...track, album: 'Album', artworkUrl: 'https://i.scdn.co/image/art' }]);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/search?q=bachata&type=track&limit=10');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: 'GET', cache: 'no-store', headers: { Authorization: 'Bearer private-access-token' } });
  });
  it('uses playlist /items, prefers current item, and supports legacy track without reviving null item', async () => {
    fetcher.mockResolvedValueOnce(Response.json({ items: [{ item: resource() }, { track: resource({ id: OTHER, uri: `spotify:track:${OTHER}` }) }, { item: null, track: resource() }, { is_local: true, item: resource() }] }));
    const { playlistTracks } = await import('./client');
    expect((await playlistTracks(ID)).map((value) => value.id)).toEqual([ID, OTHER]);
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://api.spotify.com/v1/playlists/${ID}/items?limit=20`);
    await expect(playlistTracks('../me/player')).rejects.toThrow('valid Spotify playlist');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('caps library responses and strips playlist descriptions to text', async () => {
    const { savedTracks, playlists } = await import('./client');
    fetcher.mockResolvedValueOnce(Response.json({ items: Array.from({ length: 100 }, () => ({ track: resource() })) }));
    expect(await savedTracks()).toHaveLength(20);
    fetcher.mockResolvedValueOnce(Response.json({ items: [{ id: ID, name: 'Class', description: '<b>Set</b>' }, { id: '../bad', name: 'Bad' }] }));
    expect(await playlists()).toEqual([{ id: ID, name: 'Class', description: 'Set' }]);
  });
  it('does not retain unsafe images, invalid identity, preview audio or private fields', async () => {
    const { parseSpotifyTrack } = await import('./client');
    expect(parseSpotifyTrack(resource({ album: { images: [{ url: 'https://private.example/image' }] }, preview_url: 'secret', token: 'secret' }))).toEqual(track);
    expect(parseSpotifyTrack(resource({ uri: `spotify:episode:${ID}` }))).toBeNull();
    expect(parseSpotifyTrack(resource({ duration_ms: -5 }))).toBeNull();
    expect(parseSpotifyTrack(resource({ name: 'Bad\nname' }))).toBeNull();
  });
  it.each([401, 403, 429, 500])('returns a fixed safe error for HTTP %s', async (status) => {
    fetcher.mockResolvedValueOnce(Response.json({ error: 'Bearer secret raw body' }, { status }));
    const { savedTracks } = await import('./client');
    await expect(savedTracks()).rejects.not.toThrow('secret');
  });
  it('aborts a list before requesting a token or contacting Spotify', async () => {
    const { savedTracks } = await import('./client'); const controller = new AbortController(); controller.abort();
    await expect(savedTracks(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled(); expect(token).not.toHaveBeenCalled();
  });
  it('reports a numeric Retry-After without exposing arbitrary header text', async () => {
    const { savedTracks } = await import('./client');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '45' } }));
    await expect(savedTracks()).rejects.toThrow('after 45 seconds');
    fetcher.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': 'Bearer secret' } }));
    await expect(savedTracks()).rejects.toThrow('Wait before trying again');
  });
});

describe('Spotify owned SDK lifecycle', () => {
  it('connects ready without transferring or playing and activates synchronously', async () => {
    const player = await create();
    expect(player.snapshot().ready).toBe(true); expect(fetcher).not.toHaveBeenCalled();
    expect(native.resume).not.toHaveBeenCalled(); expect(native.activateElement).not.toHaveBeenCalled();
    player.activate(); expect(native.activateElement).toHaveBeenCalledOnce();
  });
  it('starts only the ready device and selected URI at the requested bounded position', async () => {
    const player = await create(); await player.start(track, 200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.spotify.com/v1/me/player/play?device_id=owned-device');
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ uris: [track.uri], position_ms: 120000 });
    native.emit('player_state_changed', state());
    await player.seek(20); expect(native.seek).toHaveBeenCalledWith(20000);
    expect(native.resume).not.toHaveBeenCalled();
  });
  it('rejects a malformed start and scrubs synchronous SDK exceptions', async () => {
    const player = await create();
    await expect(player.start({ ...track, uri: 'spotify:track:evil' }, 0)).rejects.toThrow('valid Spotify');
    expect(fetcher).not.toHaveBeenCalled();
    native.pause.mockImplementation(() => { throw new Error('Bearer private-secret'); });
    await expect(player.pause()).rejects.toThrow('Spotify playback could not finish');
  });
  it('a paused intent suppresses a late playing state and automatic different songs', async () => {
    const player = await create(); await player.start(track, 0);
    native.emit('player_state_changed', state(ID, true)); expect(player.snapshot().playing).toBe(true);
    await player.pause(); native.emit('player_state_changed', state(ID, true));
    expect(player.snapshot().playing).toBe(false);
    await player.start(track, 0); native.emit('player_state_changed', state(OTHER, true));
    expect(player.snapshot().playing).toBe(false); expect(native.pause).toHaveBeenCalled();
  });
  it('retains Pause after a late start request and never calls a globally active device', async () => {
    const request = deferred<Response>(); fetcher.mockReturnValueOnce(request.promise);
    const player = await create(); const opening = player.start(track, 12);
    await Promise.resolve(); await Promise.resolve();
    await player.pause(); request.resolve(new Response(null, { status: 204 }));
    await expect(opening).rejects.toThrow('cancelled');
    native.emit('player_state_changed', state(ID, true)); expect(player.snapshot().playing).toBe(false);
    expect(fetcher.mock.calls.every(([url]) => String(url).includes('device_id=owned-device'))).toBe(true);
  });
  it('does not dispatch Play after Pause during an access-token refresh', async () => {
    const player = await create(); const refreshing = deferred<string>(); token.mockReturnValueOnce(refreshing.promise);
    const opening = player.start(track, 0); await player.pause();
    refreshing.resolve('private-access-token'); await expect(opening).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('suppresses old-track playback immediately during a cancelled pending start', async () => {
    const request = deferred<Response>(); fetcher.mockReturnValueOnce(request.promise);
    const player = await create(); const opening = player.start(track, 0);
    await Promise.resolve(); await Promise.resolve(); await player.pause(); native.pause.mockClear();
    native.emit('player_state_changed', state(OTHER, true)); expect(native.pause).toHaveBeenCalledOnce();
    request.resolve(new Response(null, { status: 204 })); await expect(opening).rejects.toThrow('cancelled');
  });
  it('stops a native resume that resolves after both timeout and disposal', async () => {
    vi.useFakeTimers(); const player = await create(); await player.start(track, 0); native.state = state(); native.emit('player_state_changed', native.state);
    const late = deferred<void>(); native.resume.mockReturnValueOnce(late.promise);
    const resuming = player.resume(); const rejected = expect(resuming).rejects.toThrow('could not resume');
    await vi.advanceTimersByTimeAsync(20001); await rejected; player.dispose(); native.pause.mockClear();
    late.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(native.pause).toHaveBeenCalled();
  });
  it('targets only its old device for compensation when a disposed start returns late', async () => {
    const request = deferred<Response>(); fetcher.mockReturnValueOnce(request.promise);
    const player = await create(); const opening = player.start(track, 0);
    await Promise.resolve(); await Promise.resolve(); player.dispose();
    request.resolve(new Response(null, { status: 204 })); await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await Promise.resolve();
    expect(native.disconnect).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      'https://api.spotify.com/v1/me/player/play?device_id=owned-device',
      'https://api.spotify.com/v1/me/player/pause?device_id=owned-device',
    ]);
  });
  it('disconnects, removes listeners, and suppresses asynchronous state after disposal', async () => {
    const player = await create(); const before = snapshots.length;
    player.dispose(); native.emit('player_state_changed', state(ID, true));
    expect(snapshots).toHaveLength(before); expect(native.disconnect).toHaveBeenCalledOnce();
    expect([...native.listeners.values()].every((set) => set.size === 0)).toBe(true);
    expect(player.snapshot().ready).toBe(false);
    await expect(player.start(track, 0)).rejects.toThrow('not ready');
  });
  it('cleans up an SDK which never reports ready', async () => {
    vi.useFakeTimers(); native.connect.mockResolvedValue(true);
    const { createSpotifyPlayer } = await import('./client');
    const waiting = createSpotifyPlayer(vi.fn(), errors); const rejected = expect(waiting).rejects.toThrow('could not prepare');
    await vi.advanceTimersByTimeAsync(20001); await rejected;
    expect(native.disconnect).toHaveBeenCalledOnce();
    expect([...native.listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
  it('does not accumulate hung state polls after the first bounded failure', async () => {
    vi.useFakeTimers(); const never = deferred<unknown>(); native.getCurrentState.mockReturnValue(never.promise);
    const player = await create(); await vi.advanceTimersByTimeAsync(60000);
    expect(native.getCurrentState).toHaveBeenCalledOnce(); expect(player.snapshot().ready).toBe(false);
    expect(errors).toHaveBeenCalledWith('Spotify stopped responding. Reconnect the player and try again.');
  });
  it('does not expose SDK account/auth errors containing credentials', async () => {
    const player = await create(); native.emit('authentication_error', { message: 'Bearer secret raw account' });
    expect(errors).toHaveBeenLastCalledWith('Reconnect to Spotify to continue playback.');
    expect(player.snapshot().ready).toBe(false);
  });
});

describe('Spotify SDK lazy script loading', () => {
  it('does nothing on import, then times out and removes a failed script', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Spotify', undefined);
    class Script extends EventTarget { src = ''; async = false; remove = vi.fn(); }
    const script = new Script(); const appendChild = vi.fn();
    vi.stubGlobal('document', { createElement: () => script, head: { appendChild } });
    const { createSpotifyPlayer } = await import('./client');
    expect(appendChild).not.toHaveBeenCalled();
    const waiting = createSpotifyPlayer(vi.fn(), errors); const rejected = expect(waiting).rejects.toThrow('could not load');
    expect(script.src).toBe('https://sdk.scdn.co/spotify-player.js');
    await vi.advanceTimersByTimeAsync(20001); await rejected; expect(script.remove).toHaveBeenCalledOnce();
  });
});
