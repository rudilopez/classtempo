import { getSpotifyConfig, type SpotifyConfig } from './config';

const PENDING_KEY = 'classtempo.spotify.pkce.v1';
const SESSION_KEY = 'classtempo.spotify.session.v1';
const STATE_PREFIX = 'classtempo-spotify-';
const AUTH_LIFETIME = 10 * 60_000;
const TOKEN_MARGIN = 30_000;
const REQUEST_TIMEOUT = 15_000;
// The official Web Playback SDK how-to requires the first three permissions. ClassTempo
// never fetches or stores email; the remaining permissions enable read-only browsing and
// playback on our SDK device. No playlist, library or profile write permission is requested.
// https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player
const SCOPES = [
  'streaming', 'user-read-private', 'user-read-email', 'user-library-read',
  'playlist-read-private', 'playlist-read-collaborative', 'user-modify-playback-state',
];

interface PendingAuth extends SpotifyConfig {
  version: 1;
  state: string;
  verifier: string;
  createdAt: number;
}

interface SpotifySession extends SpotifyConfig {
  version: 1;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

let generation = 0;
let sessionDisabled = false;
let callbackFlight: Promise<void> | null = null;
let refreshFlight: { generation: number; promise: Promise<string> } | null = null;
const requests = new Set<AbortController>();

function cancelled(): DOMException {
  return new DOMException('Spotify request cancelled.', 'AbortError');
}

function assertCurrent(expected: number): void {
  if (expected !== generation) throw cancelled();
}

function record(key: string): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw || raw.length > 25_000) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function remove(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* A disabled session remains unusable in memory. */ }
}

function save(key: string, value: PendingAuth | SpotifySession): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {
    throw new Error('Allow temporary browser storage to connect Spotify.');
  }
}

function matchesConfig(value: Record<string, unknown>, config: SpotifyConfig): boolean {
  return value.version === 1 && value.clientId === config.clientId && value.redirectUri === config.redirectUri;
}

function readPending(config: SpotifyConfig): PendingAuth | null {
  const value = record(PENDING_KEY);
  if (!value || !matchesConfig(value, config)
    || typeof value.state !== 'string' || !new RegExp(`^${STATE_PREFIX}[A-Za-z0-9_-]{43}$`).test(value.state)
    || typeof value.verifier !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(value.verifier)
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
    || value.createdAt > Date.now() || Date.now() - value.createdAt >= AUTH_LIFETIME) return null;
  return {
    ...config, version: 1, state: value.state, verifier: value.verifier, createdAt: value.createdAt,
  };
}

function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]{1,8192}$/.test(value);
}

function readSession(config: SpotifyConfig): SpotifySession | null {
  if (sessionDisabled) return null;
  const value = record(SESSION_KEY);
  if (!value || !matchesConfig(value, config) || !isToken(value.accessToken) || !isToken(value.refreshToken)
    || typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= 0) return null;
  return {
    ...config, version: 1, accessToken: value.accessToken, refreshToken: value.refreshToken, expiresAt: value.expiresAt,
  };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** No network, SDK initialization or credentials returned; safe for the initial route decision. */
export function hasSpotifyCallback(): boolean {
  try {
    const query = new URL(location.href).searchParams;
    if (!query.has('code') && !query.has('error')) return false;
    const state = query.get('state');
    if (state?.startsWith(STATE_PREFIX)) return true;
    // A missing state on our own pending return must display an error, never exchange a code.
    return !state && !!getSpotifyConfig() && !!record(PENDING_KEY);
  } catch {
    return false;
  }
}

export function hasSpotifySession(): boolean {
  const config = getSpotifyConfig();
  return !!config && !!readSession(config);
}

/** Cancels any outstanding grant/refresh, including responses that arrive after abort. */
export function disconnectSpotify(): void {
  generation += 1;
  sessionDisabled = true;
  for (const request of requests) request.abort();
  requests.clear();
  refreshFlight = null;
  callbackFlight = null;
  remove(PENDING_KEY);
  remove(SESSION_KEY);
}

export async function beginSpotifyAuth(): Promise<void> {
  const config = getSpotifyConfig();
  if (!config) throw new Error('Spotify is awaiting app setup.');
  disconnectSpotify();
  const expected = generation;
  try {
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(64)));
    const state = STATE_PREFIX + base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    assertCurrent(expected);
    const pending: PendingAuth = { ...config, version: 1, verifier, state, createdAt: Date.now() };
    save(PENDING_KEY, pending);
    const authorization = new URL('https://accounts.spotify.com/authorize');
    authorization.search = new URLSearchParams({
      response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri,
      state, scope: SCOPES.join(' '), code_challenge_method: 'S256', code_challenge: base64Url(new Uint8Array(digest)),
    }).toString();
    location.assign(authorization.href);
  } catch (error) {
    if (expected !== generation) throw cancelled();
    remove(PENDING_KEY);
    if (error instanceof Error && error.message === 'Allow temporary browser storage to connect Spotify.') throw error;
    throw new Error('Spotify sign-in could not start. Use a secure browser page and try again.');
  }
}

async function exchangeTokens(
  config: SpotifyConfig, body: URLSearchParams, expected: number, oldRefreshToken?: string,
): Promise<SpotifySession> {
  assertCurrent(expected);
  const request = new AbortController();
  requests.add(request);
  const timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT);
  try {
    let response: Response;
    try {
      response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
        cache: 'no-store', credentials: 'omit', redirect: 'error', signal: request.signal,
      });
    } catch {
      assertCurrent(expected);
      throw new Error('Spotify could not connect. Check your connection and try again.');
    }
    assertCurrent(expected);
    if (request.signal.aborted) throw new Error('Spotify could not connect. Check your connection and try again.');
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        sessionDisabled = true;
        remove(SESSION_KEY);
        throw new Error('Spotify sign-in expired. Connect Spotify again.');
      }
      throw new Error('Spotify could not connect. Try again shortly.');
    }
    let value: unknown;
    try { value = await response.json(); } catch {
      throw new Error('Spotify returned an invalid sign-in response. Connect Spotify again.');
    }
    assertCurrent(expected);
    if (request.signal.aborted) throw new Error('Spotify could not connect. Check your connection and try again.');
    const data = value && typeof value === 'object' ? value as Record<string, unknown> : null;
    const refreshToken = data?.refresh_token ?? oldRefreshToken;
    if (!data || !isToken(data.access_token) || !isToken(refreshToken) || data.token_type !== 'Bearer'
      || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)
      || data.expires_in <= 0 || data.expires_in > 86_400
      || (data.scope !== undefined && (typeof data.scope !== 'string'
        || SCOPES.some(scope => !data.scope!.toString().split(' ').includes(scope))))) {
      throw new Error('Spotify returned an invalid sign-in response. Connect Spotify again.');
    }
    const session: SpotifySession = {
      ...config, version: 1, accessToken: data.access_token, refreshToken, expiresAt: Date.now() + data.expires_in * 1000,
    };
    save(SESSION_KEY, session);
    sessionDisabled = false;
    return session;
  } finally {
    clearTimeout(timeout);
    requests.delete(request);
  }
}

async function finishCallback(): Promise<void> {
  if (!hasSpotifyCallback()) return;
  const expected = generation;
  const config = getSpotifyConfig();
  const pending = config ? readPending(config) : null;
  const url = new URL(location.href);
  const query = new URLSearchParams(url.search);
  // Consume before any await; the verifier and authorization code must never be replayed.
  let consumed = false;
  try { sessionStorage.removeItem(PENDING_KEY); consumed = true; } catch { /* Fail closed after cleaning the URL. */ }
  for (const key of ['code', 'state', 'error', 'error_description', 'error_uri']) url.searchParams.delete(key);
  url.hash = 'spotify';
  try { history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`); } catch {
    throw new Error('Spotify sign-in could not finish safely. Reopen ClassTempo and connect again.');
  }
  if (!consumed) throw new Error('Allow temporary browser storage to connect Spotify.');
  if (!config || !pending || query.getAll('state').length !== 1 || query.get('state') !== pending.state
    || url.origin + url.pathname !== new URL(pending.redirectUri).origin + new URL(pending.redirectUri).pathname) {
    throw new Error('Spotify sign-in expired or could not be verified. Connect Spotify again.');
  }
  if (query.has('error')) throw new Error('Spotify sign-in was not completed. Connect Spotify when ready.');
  const code = query.get('code');
  if (query.getAll('code').length !== 1 || !code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) {
    throw new Error('Spotify sign-in could not be verified. Connect Spotify again.');
  }
  await exchangeTokens(config, new URLSearchParams({
    grant_type: 'authorization_code', client_id: config.clientId, redirect_uri: pending.redirectUri,
    code, code_verifier: pending.verifier,
  }), expected);
}

export function completeSpotifyAuth(): Promise<void> {
  if (callbackFlight) return callbackFlight;
  const pending = finishCallback();
  callbackFlight = pending;
  const clear = () => { if (callbackFlight === pending) callbackFlight = null; };
  void pending.then(clear, clear);
  return pending;
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => { reject(cancelled()); };
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(signal.aborted ? cancelled() : error); },
    );
  });
}

export async function getSpotifyAccessToken(signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw cancelled();
  const config = getSpotifyConfig();
  const session = config ? readSession(config) : null;
  if (!config || !session) throw new Error('Connect Spotify to continue.');
  if (session.expiresAt > Date.now() + TOKEN_MARGIN) return session.accessToken;
  if (!refreshFlight || refreshFlight.generation !== generation) {
    const expected = generation;
    const promise = exchangeTokens(config, new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: session.refreshToken, client_id: config.clientId,
    }), expected, session.refreshToken).then(result => result.accessToken);
    const flight = { generation: expected, promise };
    refreshFlight = flight;
    const clear = () => { if (refreshFlight === flight) refreshFlight = null; };
    void promise.then(clear, clear);
  }
  return withAbort(refreshFlight.promise, signal);
}
