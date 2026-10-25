/** Public MusicKit v3 API only. Apple's SDK owns authorization and protected playback. */
export interface MusicTrack {
  id: string;
  type: 'songs' | 'library-songs';
  name: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationSeconds?: number;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  description?: string;
}

export type MusicKitEventName = 'authorizationStatusDidChange' | 'nowPlayingItemDidChange' |
  'playbackStateDidChange' | 'playbackTimeDidChange' | 'playbackDurationDidChange' |
  'playbackRateDidChange' | 'mediaPlaybackError';
export type MusicKitListener = (event: unknown) => void;

export interface MusicKitInstance {
  readonly isAuthorized: boolean;
  readonly isPlaying: boolean;
  readonly playbackState: number;
  readonly currentPlaybackTime: number;
  readonly currentPlaybackDuration: number;
  readonly nowPlayingItem: unknown;
  playbackRate: number;
  authorize(): Promise<string | void>;
  unauthorize(): Promise<void>;
  setQueue(options: { song: string; startPlaying: boolean; startTime?: number }): Promise<unknown>;
  play(): void | Promise<unknown>;
  pause(): void | Promise<unknown>;
  stop(): void | Promise<unknown>;
  seekToTime(seconds: number): Promise<void>;
  addEventListener(name: MusicKitEventName, listener: MusicKitListener): void;
  removeEventListener(name: MusicKitEventName, listener: MusicKitListener): void;
  readonly api: {
    music(path: string, parameters?: Readonly<Record<string, string | number>>): Promise<unknown>;
  };
}

interface MusicKitSdk {
  configure(options: { developerToken: string; app: { name: string; build: string } }): Promise<unknown>;
  getInstance(): unknown;
}

export interface MusicPlaybackSnapshot {
  isAuthorized: boolean;
  isPlaying: boolean;
  playbackState: number | null;
  currentTime: number;
  duration: number;
  rate: number;
  track: MusicTrack | null;
}

const SDK_URL = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 25;
let sdkLoading: Promise<MusicKitSdk> | null = null;
let configuration: { token: string; promise: Promise<MusicKitInstance> } | null = null;
let configurationGeneration = 0;
let configuring = false;
const loadingQueues = new WeakSet<MusicKitInstance>();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.trim();
  return result && result.length <= maxLength && !/[\u0000-\u001f]/.test(result) ? result : undefined;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readSdk(): MusicKitSdk | null {
  const sdk = (globalThis as typeof globalThis & { MusicKit?: unknown }).MusicKit;
  const value = record(sdk);
  return value && typeof value.configure === 'function' && typeof value.getInstance === 'function'
    ? sdk as MusicKitSdk : null;
}

function validInstance(value: unknown): value is MusicKitInstance {
  const candidate = record(value);
  const api = record(candidate?.api);
  return !!candidate && typeof candidate.isAuthorized === 'boolean' && typeof api?.music === 'function' &&
    ['authorize', 'unauthorize', 'setQueue', 'play', 'pause', 'stop', 'seekToTime', 'addEventListener', 'removeEventListener']
      .every((method) => typeof candidate[method] === 'function');
}

function timed<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), TIMEOUT_MS);
    void promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

/** Loading is opt-in; importing this module never contacts Apple. Failed loads can be retried. */
function loadSdk(): Promise<MusicKitSdk> {
  const existing = readSdk();
  if (existing) return Promise.resolve(existing);
  if (sdkLoading) return sdkLoading;
  if (typeof document === 'undefined') return Promise.reject(new Error('Apple Music requires a browser.'));
  const attempt = new Promise<MusicKitSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      document.removeEventListener('musickitloaded', ready);
      script.removeEventListener('error', failed);
    };
    const failed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      reject(new Error('Apple Music could not load. Check your connection and try again.'));
    };
    const ready = (): void => {
      if (settled) return;
      const sdk = readSdk();
      if (!sdk) { failed(); return; }
      settled = true;
      cleanup();
      resolve(sdk);
    };
    const timeout = setTimeout(failed, TIMEOUT_MS);
    document.addEventListener('musickitloaded', ready);
    script.addEventListener('error', failed);
    try { document.head.appendChild(script); } catch { failed(); }
  });
  sdkLoading = attempt;
  void attempt.catch(() => { if (sdkLoading === attempt) sdkLoading = null; });
  return attempt;
}

/** Configure before enabling Connect/Play so their native user gestures reach the SDK immediately. */
export function loadMusicKit(developerToken: string): Promise<MusicKitInstance> {
  if (!developerToken.trim()) return Promise.reject(new Error('Apple Music is not configured yet.'));
  if (configuration) {
    if (configuration.token === developerToken) return configuration.promise;
    return Promise.reject(new Error('Reload ClassTempo to use updated Apple Music settings.'));
  }
  // A timeout cannot cancel Apple's native operation. Do not let a late configuration overwrite a retry.
  if (configuring) return Promise.reject(new Error('Apple Music setup is still finishing. Wait, or close and reopen ClassTempo.'));
  const generation = ++configurationGeneration;
  const promise = (async (): Promise<MusicKitInstance> => {
    try {
      const sdk = await loadSdk();
      configuring = true;
      let operation: Promise<unknown>;
      try { operation = Promise.resolve(sdk.configure({ developerToken, app: { name: 'ClassTempo', build: '1' } })); }
      catch (error) { configuring = false; throw error; }
      void operation.then(() => { configuring = false; }, () => { configuring = false; });
      const configured = await timed(operation,
        'Apple Music setup took too long. Try again.');
      if (generation !== configurationGeneration) throw new Error('Stale Apple Music setup.');
      const instance = validInstance(configured) ? configured : sdk.getInstance();
      if (!validInstance(instance)) throw new Error('Invalid Apple Music instance.');
      return instance;
    } catch {
      // SDK exceptions can carry request headers or tokens. Only fixed messages leave this boundary.
      throw new Error('Apple Music could not start. Check your connection and setup, then try again.');
    }
  })();
  configuration = { token: developerToken, promise };
  void promise.catch(() => {
    if (configuration?.promise === promise) { configuration = null; configurationGeneration++; }
  });
  return promise;
}

function artwork(value: unknown): string | undefined {
  const template = text(record(value)?.url, 2000);
  if (!template) return undefined;
  try {
    const url = new URL(template.replaceAll('{w}', '300').replaceAll('{h}', '300').replaceAll('{f}', 'jpg'));
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

function parseTrack(value: unknown, playing = false): MusicTrack | null {
  const item = record(value);
  const attributes = record(item?.attributes);
  const id = text(item?.id, 256);
  const name = text(attributes?.name);
  const type = item?.type === 'library-songs' || (playing && item?.type === 'song' && id?.startsWith('i.'))
    ? 'library-songs' : item?.type === 'songs' || (playing && item?.type === 'song') ? 'songs' : null;
  if (!id || !name || !type) return null;
  const duration = attributes?.durationInMillis;
  const album = text(attributes?.albumName);
  const artworkUrl = artwork(attributes?.artwork);
  return {
    id, type, name, artist: text(attributes?.artistName) ?? 'Unknown artist',
    ...(album ? { album } : {}),
    ...(artworkUrl ? { artworkUrl } : {}),
    ...(finite(duration) && duration > 0 ? { durationSeconds: duration / 1000 } : {}),
  };
}

async function request(instance: MusicKitInstance, path: string, parameters: Record<string, string | number>): Promise<Record<string, unknown>> {
  try {
    const response = record(await timed(instance.api.music(path, parameters), 'Apple Music did not respond.'));
    const data = record(response?.data);
    if (!data || (Array.isArray(data.errors) && data.errors.length > 0)) throw new Error('Invalid Apple Music response.');
    return data;
  } catch {
    throw new Error('Apple Music could not load this list. Check your connection and Apple Music access, then try again.');
  }
}

function tracks(value: unknown): MusicTrack[] {
  if (!Array.isArray(value)) throw new Error('Apple Music returned an unreadable song list. Try again.');
  return value.slice(0, PAGE_SIZE).map((item) => parseTrack(item)).filter((item): item is MusicTrack => item !== null);
}

/** Only the first page is fetched. The connection-test UI must say “up to 25 results.” */
export async function searchSongs(instance: MusicKitInstance, term: string): Promise<MusicTrack[]> {
  const query = term.trim();
  if (!query) return [];
  const data = await request(instance, '/v1/catalog/{{storefrontId}}/search', { term: query.slice(0, 200), types: 'songs', limit: PAGE_SIZE });
  const results = record(data.results);
  if (!results) throw new Error('Apple Music returned an unreadable search result. Try again.');
  if (results.songs === undefined) return [];
  return tracks(record(results.songs)?.data);
}

function requireAuthorization(instance: MusicKitInstance): void {
  if (!instance.isAuthorized) throw new Error('Connect to Apple Music to open your library.');
}

/** Reading never adds, edits or removes anything in the user's Apple Music library. */
export async function librarySongs(instance: MusicKitInstance): Promise<MusicTrack[]> {
  requireAuthorization(instance);
  const data = await request(instance, '/v1/me/library/songs', { limit: PAGE_SIZE });
  return tracks(data.data);
}

export async function libraryPlaylists(instance: MusicKitInstance): Promise<MusicPlaylist[]> {
  requireAuthorization(instance);
  const data = await request(instance, '/v1/me/library/playlists', { limit: PAGE_SIZE });
  if (!Array.isArray(data.data)) throw new Error('Apple Music returned an unreadable playlist list. Try again.');
  return data.data.slice(0, PAGE_SIZE).flatMap((value): MusicPlaylist[] => {
    const item = record(value);
    const attributes = record(item?.attributes);
    const id = text(item?.id, 256);
    const name = text(attributes?.name);
    if (!id || !name || item?.type !== 'library-playlists') return [];
    const description = text(record(attributes?.description)?.standard, 2000);
    return [{ id, name, ...(description ? { description } : {}) }];
  });
}

export async function playlistSongs(instance: MusicKitInstance, playlistId: string): Promise<MusicTrack[]> {
  requireAuthorization(instance);
  const id = text(playlistId, 256);
  if (!id) throw new Error('Choose an Apple Music playlist.');
  const data = await request(instance, `/v1/me/library/playlists/${encodeURIComponent(id)}/tracks`, { limit: PAGE_SIZE });
  return tracks(data.data);
}

/** Song IDs remain provider IDs, including i.* library IDs; they are never treated as local files. */
export async function loadSelected(instance: MusicKitInstance, track: MusicTrack): Promise<void> {
  if (!text(track.id, 256)) throw new Error('Choose an Apple Music song.');
  if (loadingQueues.has(instance)) throw new Error('Apple Music is still loading a song. Wait, or close and reopen ClassTempo.');
  loadingQueues.add(instance);
  // Guard the native operation, not the timeout wrapper. MusicKit has no cancellation API for setQueue.
  const operation = (async (): Promise<void> => {
    await instance.pause();
    await instance.setQueue({ song: track.id, startPlaying: false });
  })();
  void operation.then(() => { loadingQueues.delete(instance); }, () => { loadingQueues.delete(instance); });
  try {
    await timed(operation, 'Apple Music did not load this song.');
  } catch {
    throw new Error('This song could not load from Apple Music. Check your subscription and connection, then try again.');
  }
}

/** Return only display data; never copy the SDK instance, user token or raw errors into diagnostics. */
export function snapshot(instance: MusicKitInstance): MusicPlaybackSnapshot {
  const time = instance.currentPlaybackTime;
  const duration = instance.currentPlaybackDuration;
  const rate = instance.playbackRate;
  const state = instance.playbackState;
  return {
    isAuthorized: instance.isAuthorized === true,
    isPlaying: instance.isPlaying === true,
    playbackState: finite(state) ? state : null,
    currentTime: finite(time) && time >= 0 ? time : 0,
    duration: finite(duration) && duration >= 0 ? duration : 0,
    rate: finite(rate) && rate > 0 ? rate : 1,
    track: parseTrack(instance.nowPlayingItem, true),
  };
}
