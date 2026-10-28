import { getSpotifyAccessToken } from './auth';

export interface MusicTrack {
  id: string;
  uri: string;
  name: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds: number;
  externalUrl: string;
}
export interface MusicPlaylist { id: string; name: string; description?: string }
export interface SpotifySnapshot {
  ready: boolean;
  playing: boolean;
  position: number;
  duration: number;
  trackId: string | null;
}
export interface SpotifyPlayer {
  /** Call inside the Play gesture, before awaiting any network work. */
  activate(): void;
  start(track: MusicTrack, positionSeconds: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(seconds: number): Promise<void>;
  dispose(): void;
  snapshot(): SpotifySnapshot;
}

type Listener = (value: unknown) => void;
interface NativePlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(milliseconds: number): Promise<void>;
  getCurrentState(): Promise<unknown>;
  addListener(name: string, listener: Listener): boolean;
  removeListener(name: string, listener: Listener): boolean;
}
interface SpotifySdk {
  Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; enableMediaSession: boolean }) => NativePlayer;
}
const API = 'https://api.spotify.com/v1/';
const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const TIMEOUT = 20_000;
const ID = /^[A-Za-z0-9]{22}$/;
let sdkLoading: Promise<SpotifySdk> | null = null;

class RateLimitError extends Error {
  constructor(value: string | null) {
    const seconds = value && /^\d{1,4}$/.test(value) ? Number(value) : 0;
    super(seconds > 0 && seconds <= 3600 ? `Spotify is receiving too many requests. Try again after ${seconds} seconds.`
      : 'Spotify is receiving too many requests. Wait before trying again.');
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.trim();
  return clean && clean.length <= max && !/[\u0000-\u001f\u007f]/.test(clean) ? clean : undefined;
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function abortError(): DOMException { return new DOMException('Spotify request cancelled.', 'AbortError'); }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
function imageUrl(value: unknown): string | undefined {
  const raw = text(value, 2000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname.endsWith('.scdn.co') || url.hostname.endsWith('.spotifycdn.com')) ? url.href : undefined;
  } catch { return undefined; }
}

/** Whitelist song display data. Never retain previews, account data, arbitrary URLs or local Spotify files. */
export function parseSpotifyTrack(value: unknown): MusicTrack | null {
  const item = record(value);
  const id = text(item?.id, 22);
  const name = text(item?.name);
  const duration = item?.duration_ms;
  if (!item || item.type !== 'track' || !id || !ID.test(id) || !name || !finite(duration) || duration <= 0 ||
    item.is_local === true || item.is_playable === false || item.uri !== `spotify:track:${id}`) return null;
  const album = record(item.album);
  const artists = Array.isArray(item.artists) ? item.artists.slice(0, 10).flatMap((artist) => {
    const name = text(record(artist)?.name); return name ? [name] : [];
  }) : [];
  const images = Array.isArray(album?.images) ? album.images : [];
  const artworkUrl = images.slice(0, 10).map((image) => imageUrl(record(image)?.url)).find(Boolean);
  const albumName = text(album?.name);
  return { id, uri: `spotify:track:${id}`, name, artist: artists.join(', ') || 'Unknown artist',
    durationSeconds: duration / 1000, externalUrl: `https://open.spotify.com/track/${id}`,
    ...(albumName ? { album: albumName } : {}), ...(artworkUrl ? { artworkUrl } : {}) };
}

async function apiRequest(path: string, signal?: AbortSignal, body?: unknown, beforeSend?: () => void): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, TIMEOUT);
  try {
    checkAbort(signal);
    const token = await getSpotifyAccessToken(controller.signal);
    checkAbort(controller.signal);
    beforeSend?.();
    const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'PUT',
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      cache: 'no-store', credentials: 'omit', redirect: 'error' });
    checkAbort(controller.signal);
    if (response.status === 401) throw new Error('Reconnect to Spotify, then try again.');
    if (response.status === 403) throw new Error('Spotify access is unavailable. Check Premium and the app’s approved users.');
    if (response.status === 429) throw new RateLimitError(response.headers.get('Retry-After'));
    if (!response.ok) throw new Error('Spotify could not complete this request. Try again while connected.');
    return response.status === 204 ? null : await response.json() as unknown;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (error instanceof RateLimitError) throw error;
    // Only our own fixed errors may cross this boundary; never provider bodies or auth exceptions.
    if (error instanceof Error && [
      'Reconnect to Spotify, then try again.',
      'Spotify access is unavailable. Check Premium and the app’s approved users.',
      'Spotify could not complete this request. Try again while connected.',
      'Spotify playback action cancelled.',
    ].includes(error.message)) throw error;
    throw new Error(controller.signal.aborted ? 'Spotify took too long. Try again while connected.' : 'Spotify could not connect. Reconnect and try again.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
function items(value: unknown): unknown[] {
  const list = record(value)?.items;
  if (!Array.isArray(list)) throw new Error('Spotify returned an unavailable list. Try again.');
  return list.slice(0, 20);
}
function tracks(values: unknown[]): MusicTrack[] { return values.flatMap((value) => { const track = parseSpotifyTrack(value); return track ? [track] : []; }); }
export async function searchTracks(query: string, signal?: AbortSignal): Promise<MusicTrack[]> {
  const clean = text(query, 200);
  if (!clean) return [];
  const data = record(await apiRequest(`search?${new URLSearchParams({ q: clean, type: 'track', limit: '10' })}`, signal));
  return tracks(items(data?.tracks));
}
export async function savedTracks(signal?: AbortSignal): Promise<MusicTrack[]> {
  return tracks(items(await apiRequest('me/tracks?limit=20', signal)).map((value) => record(value)?.track));
}
export async function playlists(signal?: AbortSignal): Promise<MusicPlaylist[]> {
  return items(await apiRequest('me/playlists?limit=20', signal)).flatMap((value) => {
    const item = record(value); const id = text(item?.id, 22); const name = text(item?.name);
    if (!id || !ID.test(id) || !name) return [];
    const description = text(item?.description, 1000)?.replace(/<[^>]*>/g, '').trim();
    return [{ id, name, ...(description ? { description } : {}) }];
  });
}
export async function playlistTracks(id: string, signal?: AbortSignal): Promise<MusicTrack[]> {
  if (!ID.test(id)) throw new Error('Choose a valid Spotify playlist.');
  // Current API uses /items and item. Older responses can still contain deprecated track.
  return tracks(items(await apiRequest(`playlists/${id}/items?limit=20`, signal)).map((value) => {
    const item = record(value);
    return item?.is_local === true ? null : item && ('item' in item ? item.item : item.track);
  }));
}

function readSdk(): SpotifySdk | null {
  const candidate = (globalThis as typeof globalThis & { Spotify?: unknown }).Spotify;
  return typeof record(candidate)?.Player === 'function' ? candidate as SpotifySdk : null;
}
function loadSdk(): Promise<SpotifySdk> {
  const available = readSdk();
  if (available) return Promise.resolve(available);
  if (sdkLoading) return sdkLoading;
  if (typeof document === 'undefined') return Promise.reject(new Error('Spotify needs a browser.'));
  const global = globalThis as typeof globalThis & { onSpotifyWebPlaybackSDKReady?: () => void };
  const previous = global.onSpotifyWebPlaybackSDKReady;
  const promise = new Promise<SpotifySdk>((resolve, reject) => {
    const script = document.createElement('script'); script.src = SDK_URL; script.async = true;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer); script.removeEventListener('error', fail);
      if (global.onSpotifyWebPlaybackSDKReady === ready) global.onSpotifyWebPlaybackSDKReady = previous;
    };
    const fail = () => { if (settled) return; settled = true; cleanup(); script.remove(); reject(new Error('Spotify could not load. Check your connection and try again.')); };
    const ready = () => {
      if (settled) return;
      const sdk = readSdk(); if (!sdk) { fail(); return; }
      settled = true; cleanup(); resolve(sdk);
    };
    const timer = setTimeout(fail, TIMEOUT);
    global.onSpotifyWebPlaybackSDKReady = ready;
    script.addEventListener('error', fail);
    try { document.head.appendChild(script); } catch { fail(); }
  });
  sdkLoading = promise;
  void promise.catch(() => { if (sdkLoading === promise) sdkLoading = null; });
  return promise;
}
function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Spotify playback took too long. Reconnect and try again.')), TIMEOUT);
    operation.then((value) => { clearTimeout(timer); resolve(value); }, () => {
      clearTimeout(timer); reject(new Error('Spotify playback could not finish. Try again.'));
    });
  });
}

/** No transfer or playback happens here. Each instance owns only its SDK device. */
export async function createSpotifyPlayer(onSnapshot: (value: SpotifySnapshot) => void, onError: (message: string) => void): Promise<SpotifyPlayer> {
  const sdk = await loadSdk();
  let disposed = false;
  let ready = false;
  let deviceId: string | null = null;
  let expectedId: string | null = null;
  let wantsPlaying = false;
  let revision = 0;
  let starting = false;
  let polling = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const lifetime = new AbortController();
  let current: SpotifySnapshot = { ready: false, playing: false, position: 0, duration: 0, trackId: null };
  let disallows: Record<string, unknown> = {};
  const listeners: [string, Listener][] = [];
  const emit = () => { if (!disposed) onSnapshot({ ...current, ready }); };
  const quietPause = () => { try { void native.pause().catch(() => {}); } catch { /* Cleanup is best effort. */ } };
  let native: NativePlayer;
  try {
    native = new sdk.Player({ name: 'ClassTempo', enableMediaSession: true,
      getOAuthToken(callback) {
        void getSpotifyAccessToken(lifetime.signal).then((token) => { if (!disposed) callback(token); }, () => {
          if (!disposed) { wantsPlaying = false; quietPause(); onError('Reconnect to Spotify to continue playback.'); }
        });
      },
    });
  } catch { throw new Error('This browser could not start protected Spotify playback.'); }
  const add = (name: string, listener: Listener) => { native.addListener(name, listener); listeners.push([name, listener]); };
  const acceptState = (value: unknown) => {
    if (disposed) return;
    const state = record(value);
    if (!state) { current = { ready, playing: false, position: 0, duration: 0, trackId: null }; emit(); return; }
    const track = record(record(state.track_window)?.current_track);
    const id = text(track?.id, 22);
    const trackId = id && ID.test(id) ? id : null;
    const duration = finite(state.duration) && state.duration >= 0 ? state.duration / 1000 : 0;
    const position = finite(state.position) && state.position >= 0 ? Math.min(duration, state.position / 1000) : 0;
    const playing = state.paused === false;
    disallows = record(state.disallows) ?? {};
    // A stale Play, Spotify autoplay, or an external queue must never revive an inactive selection.
    if (playing && (!wantsPlaying || !expectedId || trackId !== expectedId)) {
      if (!wantsPlaying || !starting || !expectedId) { wantsPlaying = false; quietPause(); }
    }
    current = { ready, playing: playing && wantsPlaying && trackId === expectedId, position, duration, trackId };
    emit();
  };
  const poll = () => {
    if (disposed || polling || !ready) return;
    polling = true;
    const token = revision;
    void bounded(Promise.resolve().then(() => native.getCurrentState())).then((state) => { if (!disposed && token === revision) acceptState(state); }, () => {
      if (!disposed) {
        ready = false; wantsPlaying = false; revision++; current.playing = false; quietPause(); emit();
        onError('Spotify stopped responding. Reconnect the player and try again.');
      }
    })
      .finally(() => { polling = false; });
  };
  const dispose = () => {
    if (disposed) return;
    wantsPlaying = false; revision++; quietPause(); disposed = true; ready = false; lifetime.abort();
    if (pollTimer) clearInterval(pollTimer);
    for (const [name, listener] of listeners) { try { native.removeListener(name, listener); } catch { /* Continue teardown. */ } }
    try { native.disconnect(); } catch { /* Cleanup cannot throw. */ }
  };
  const assertReady = () => { if (disposed || !ready || !deviceId) throw new Error('Spotify is not ready. Reconnect and try again.'); };
  const ownedLatePause = (id: string) => {
    quietPause();
    // A delivered REST Play cannot be unsent. Pause only this instance's device if it completes after disposal.
    if (disposed) void apiRequest(`me/player/pause?device_id=${encodeURIComponent(id)}`, undefined, {}).catch(() => {});
  };
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (disposed) return;
      wantsPlaying = false; quietPause();
      if (!settled) { settled = true; clearTimeout(timer); dispose(); reject(new Error(message)); }
      else { ready = false; current.playing = false; emit(); onError(message); }
    };
    const timer = setTimeout(() => fail('Spotify could not prepare this browser. Reconnect and try again.'), TIMEOUT);
    add('ready', (value) => {
      if (disposed) return;
      const id = text(record(value)?.device_id, 256);
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) { fail('Spotify returned an unavailable browser device.'); return; }
      deviceId = id; ready = true; current.ready = true; emit();
      if (!settled) { settled = true; clearTimeout(timer); resolve(); pollTimer = setInterval(poll, 1000); }
      poll();
    });
    add('not_ready', () => { if (!disposed) { ready = false; wantsPlaying = false; revision++; current.playing = false; emit(); onError('Spotify disconnected. Reconnect to continue.'); } });
    add('player_state_changed', acceptState);
    add('autoplay_failed', () => { wantsPlaying = false; quietPause(); if (!disposed) onError('Tap Play again to allow Spotify audio in this browser.'); });
    add('initialization_error', () => fail('This browser could not start protected Spotify playback.'));
    add('authentication_error', () => fail('Reconnect to Spotify to continue playback.'));
    add('account_error', () => fail('Spotify playback requires an eligible Premium account.'));
    add('playback_error', () => { wantsPlaying = false; quietPause(); if (!disposed) onError('Spotify could not play this song. Choose another song or try again.'); });
    try { void native.connect().then((connected) => { if (!connected) fail('Spotify could not connect. Try again.'); }, () => fail('Spotify could not connect. Try again.')); }
    catch { fail('Spotify could not connect. Try again.'); }
  });
  return {
    activate() {
      assertReady();
      try { void native.activateElement().catch(() => { if (!disposed) onError('Tap Play again to allow Spotify audio.'); }); }
      catch { throw new Error('Tap Play again to allow Spotify audio.'); }
    },
    async start(track, seconds) {
      assertReady();
      if (starting) throw new Error('Spotify is still opening a song. Wait a moment.');
      if (!ID.test(track.id) || track.uri !== `spotify:track:${track.id}` || !finite(seconds) || !finite(track.durationSeconds) || track.durationSeconds <= 0) throw new Error('Choose a valid Spotify song and position.');
      const id = deviceId!; const token = ++revision;
      expectedId = track.id; wantsPlaying = true; starting = true;
      try {
        await apiRequest(`me/player/play?device_id=${encodeURIComponent(id)}`, lifetime.signal,
          { uris: [track.uri], position_ms: Math.round(Math.max(0, Math.min(seconds, track.durationSeconds)) * 1000) },
          () => { if (disposed || token !== revision || !wantsPlaying) throw new Error('Spotify playback action cancelled.'); });
        if (disposed || token !== revision) { if (disposed || !wantsPlaying) ownedLatePause(id); throw new Error('Spotify playback action cancelled.'); }
        poll();
      } catch (error) {
        if (token === revision) wantsPlaying = false;
        if (disposed || !wantsPlaying) ownedLatePause(id);
        throw error;
      } finally { starting = false; }
    },
    async pause() {
      wantsPlaying = false; revision++;
      if (disposed) return;
      current.playing = false; emit();
      await bounded(Promise.resolve().then(() => native.pause()));
    },
    async resume() {
      assertReady();
      if (!expectedId || current.trackId !== expectedId || disallows.resuming === true) throw new Error('Select this song again before playing.');
      const token = ++revision; wantsPlaying = true;
      const operation = Promise.resolve().then(() => {
        if (disposed || token !== revision || !wantsPlaying) throw new Error('Spotify playback action cancelled.');
        return native.resume();
      });
      // Observe the real SDK operation too: a timeout cannot cancel its later native completion.
      void operation.then(() => { if (disposed || !wantsPlaying) quietPause(); }, () => {});
      try { await bounded(operation); if (disposed || !wantsPlaying) quietPause(); }
      catch { if (token === revision) { wantsPlaying = false; quietPause(); } throw new Error('Spotify could not resume. Try again.'); }
    },
    async seek(seconds) {
      assertReady();
      if (!finite(seconds) || !expectedId || current.trackId !== expectedId || disallows.seeking === true) throw new Error('Spotify cannot seek this song yet.');
      const token = revision;
      await bounded(Promise.resolve().then(() => native.seek(Math.round(Math.max(0, Math.min(seconds, current.duration)) * 1000))));
      if (disposed || token !== revision) { if (!wantsPlaying) quietPause(); throw new Error('Spotify playback action cancelled.'); }
      poll();
    },
    dispose,
    snapshot() { return { ...current, ready: ready && !disposed }; },
  };
}
