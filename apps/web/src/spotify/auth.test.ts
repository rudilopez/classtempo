import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pendingKey = 'classtempo.spotify.pkce.v1';
const sessionKey = 'classtempo.spotify.session.v1';
const clientId = 'a'.repeat(32);
const redirectUri = 'https://example.com/classtempo/';
const state = 'classtempo-spotify-' + 'b'.repeat(43);
const now = 1_800_000_000_000;
let storage: Map<string, string>;
let browserLocation: { href: string; assign: ReturnType<typeof vi.fn> };
let auth: typeof import('./auth');

function pending(overrides: Record<string, unknown> = {}): void {
  storage.set(pendingKey, JSON.stringify({ version: 1, clientId, redirectUri, state, verifier: 'c'.repeat(86), createdAt: now, ...overrides }));
}

function session(overrides: Record<string, unknown> = {}): void {
  storage.set(sessionKey, JSON.stringify({
    version: 1, clientId, redirectUri, accessToken: 'old-access', refreshToken: 'old-refresh', expiresAt: now + 3600_000, ...overrides,
  }));
}

function callback(query = `code=returned-code&state=${state}`): void {
  browserLocation.href = redirectUri + '?' + query;
}

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    token_type: 'Bearer', access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600, ...overrides,
  }), { status: 200 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('Spotify PKCE and tab-scoped session', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', clientId);
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', '');
    vi.stubEnv('BASE_URL', '/classtempo/');
    storage = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Never use persistent credential storage'); },
      setItem: () => { throw new Error('Never use persistent credential storage'); },
    });
    browserLocation = { href: redirectUri + '#spotify', assign: vi.fn() };
    vi.stubGlobal('location', browserLocation);
    vi.stubGlobal('history', {
      state: { app: true },
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        browserLocation.href = new URL(url, browserLocation.href).href;
      }),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse()));
    auth = await import('./auth');
  });
  afterEach(() => {
    auth.disconnectSpotify();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('generates random state and a matching S256 challenge, storing only in this tab', async () => {
    storage.set('unrelated', 'keep');
    await auth.beginSpotifyAuth();
    const saved = JSON.parse(storage.get(pendingKey)!) as { state: string; verifier: string; createdAt: number };
    const url = new URL(browserLocation.assign.mock.calls[0]![0] as string);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saved.verifier));
    const encoded = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize');
    expect(url.searchParams.get('code_challenge')).toBe(encoded);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(url.searchParams.has('client_secret')).toBe(false);
    expect(saved.verifier).toHaveLength(86);
    expect(saved.createdAt).toBe(now);
    expect(storage.get('unrelated')).toBe('keep');
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual(['streaming', 'user-read-private', 'user-read-email', 'user-library-read', 'playlist-read-private', 'playlist-read-collaborative', 'user-modify-playback-state']);
    await auth.beginSpotifyAuth();
    expect(JSON.parse(storage.get(pendingKey)!).state).not.toBe(saved.state);
  });

  it('detects only its callback without consuming it or initializing the SDK', () => {
    callback('code=other-provider&state=other-state');
    expect(auth.hasSpotifyCallback()).toBe(false);
    pending();
    callback();
    expect(auth.hasSpotifyCallback()).toBe(true);
    expect(auth.hasSpotifyCallback()).toBe(true);
    expect(storage.has(pendingKey)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('consumes its verifier and removes auth query before exchange, preserving other query and #spotify', async () => {
    pending();
    callback(`campaign=one&code=returned-code&state=${state}`);
    const response = deferred<Response>();
    vi.mocked(fetch).mockImplementation(() => {
      expect(storage.has(pendingKey)).toBe(false);
      expect(browserLocation.href).toBe(redirectUri + '?campaign=one#spotify');
      return response.promise;
    });
    const first = auth.completeSpotifyAuth();
    expect(auth.completeSpotifyAuth()).toBe(first);
    response.resolve(tokenResponse());
    await first;
    expect(auth.hasSpotifySession()).toBe(true);
    expect(await auth.getSpotifyAccessToken()).toBe('new-access');
    await auth.completeSpotifyAuth();
    expect(fetch).toHaveBeenCalledTimes(1);
    const options = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error' });
    expect((options.body as URLSearchParams).get('code_verifier')).toBe('c'.repeat(86));
    expect((options.body as URLSearchParams).has('client_secret')).toBe(false);
    expect(Object.keys(JSON.parse(storage.get(sessionKey)!)).sort()).toEqual([
      'accessToken', 'clientId', 'expiresAt', 'redirectUri', 'refreshToken', 'version',
    ]);
    callback();
    await expect(auth.completeSpotifyAuth()).rejects.toThrow('could not be verified');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { query: `code=secret&state=${state}x`, change: {} },
    { query: 'code=secret', change: {} },
    { query: `code=secret&state=${state}&state=${state}`, change: {} },
    { query: `code=secret&code=other&state=${state}`, change: {} },
    { query: `code=secret&state=${state}`, change: { createdAt: now - 600_000 } },
    { query: `code=secret&state=${state}`, change: { createdAt: now + 1 } },
    { query: `code=secret&state=${state}`, change: { clientId: 'different' } },
  ])('rejects invalid callback state, age or code without exchanging or echoing secrets: $query', async ({ query, change }) => {
    pending(change);
    callback(query);
    await expect(auth.completeSpotifyAuth()).rejects.toThrow(/Spotify sign-in/);
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has(pendingKey)).toBe(false);
    expect(browserLocation.href).toBe(redirectUri + '#spotify');
  });

  it('handles consent denial without reflecting provider error text', async () => {
    pending();
    callback(`error=private-server-message&error_description=private-description&state=${state}`);
    await expect(auth.completeSpotifyAuth()).rejects.toThrow('Spotify sign-in was not completed. Connect Spotify when ready.');
    expect(fetch).not.toHaveBeenCalled();
    expect(browserLocation.href).toBe(redirectUri + '#spotify');
  });

  it('refuses exchange when callback cannot be removed from browser history', async () => {
    pending();
    callback();
    vi.mocked(history.replaceState).mockImplementation(() => { throw new Error('private'); });
    await expect(auth.completeSpotifyAuth()).rejects.toThrow('could not finish safely');
    expect(fetch).not.toHaveBeenCalled();
    expect(storage.has(pendingKey)).toBe(false);
  });

  it('refuses exchange when it cannot consume the pending verifier, but still cleans the URL', async () => {
    pending();
    callback();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: () => { throw new Error('blocked'); },
    });
    await expect(auth.completeSpotifyAuth()).rejects.toThrow('Allow temporary browser storage');
    expect(fetch).not.toHaveBeenCalled();
    expect(browserLocation.href).toBe(redirectUri + '#spotify');
  });

  it('shares refresh, preserves an omitted replacement refresh token, and aborts only the cancelled caller', async () => {
    session({ expiresAt: now + 1000 });
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const caller = new AbortController();
    const first = auth.getSpotifyAccessToken(caller.signal);
    const cancelledRequest = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const second = auth.getSpotifyAccessToken();
    caller.abort();
    await cancelledRequest;
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal?.aborted).toBe(false);
    response.resolve(tokenResponse({ refresh_token: undefined }));
    expect(await second).toBe('new-access');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(sessionKey)!).refreshToken).toBe('old-refresh');
    expect((vi.mocked(fetch).mock.calls[0]![1]!.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
  });

  it('disconnect invalidates a late refresh even if the network ignores abort', async () => {
    session({ expiresAt: now });
    storage.set('unrelated', 'keep');
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const result = expect(auth.getSpotifyAccessToken()).rejects.toMatchObject({ name: 'AbortError' });
    auth.disconnectSpotify();
    response.resolve(tokenResponse());
    await result;
    expect(auth.hasSpotifySession()).toBe(false);
    expect(storage).toEqual(new Map([['unrelated', 'keep']]));
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal?.aborted).toBe(true);
  });

  it('disconnect invalidates a late callback exchange', async () => {
    pending();
    callback();
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const result = expect(auth.completeSpotifyAuth()).rejects.toMatchObject({ name: 'AbortError' });
    auth.disconnectSpotify();
    response.resolve(tokenResponse());
    await result;
    expect(storage.size).toBe(0);
    expect(auth.hasSpotifySession()).toBe(false);
  });

  it('clears rejected refresh credentials but permits retry after a network failure', async () => {
    session({ expiresAt: now });
    vi.mocked(fetch).mockRejectedValueOnce(new Error('contains-private-url-and-token'));
    await expect(auth.getSpotifyAccessToken()).rejects.toThrow('Spotify could not connect. Check your connection and try again.');
    expect(auth.hasSpotifySession()).toBe(true);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('private-error', { status: 400 }));
    await expect(auth.getSpotifyAccessToken()).rejects.toThrow('Spotify sign-in expired. Connect Spotify again.');
    expect(auth.hasSpotifySession()).toBe(false);
    expect(storage.has(sessionKey)).toBe(false);
  });

  it('bounds token requests and leaves a temporary network failure retryable', async () => {
    session({ expiresAt: now });
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const result = expect(auth.getSpotifyAccessToken()).rejects.toThrow('Check your connection');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
    expect(auth.hasSpotifySession()).toBe(true);
  });

  it.each([
    { access_token: 'private\nvalue' }, { token_type: 'Other' }, { expires_in: 0 },
    { expires_in: '3600' }, { refresh_token: '' }, { scope: 'streaming' },
  ])('rejects invalid token responses without persisting them: %j', async fields => {
    pending();
    callback();
    vi.mocked(fetch).mockResolvedValueOnce(tokenResponse(fields));
    await expect(auth.completeSpotifyAuth()).rejects.toThrow('invalid sign-in response');
    expect(storage.has(sessionKey)).toBe(false);
  });

  it('fails closed for denied storage, invalid configuration and previously aborted callers', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('private'); }, setItem: () => { throw new Error('private'); }, removeItem: () => {},
    });
    expect(auth.hasSpotifySession()).toBe(false);
    await expect(auth.beginSpotifyAuth()).rejects.toThrow('Allow temporary browser storage');
    expect(browserLocation.assign).not.toHaveBeenCalled();
    const signal = new AbortController(); signal.abort();
    await expect(auth.getSpotifyAccessToken(signal.signal)).rejects.toMatchObject({ name: 'AbortError' });
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', '');
    await expect(auth.beginSpotifyAuth()).rejects.toThrow('awaiting app setup');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('disconnect stays effective if removal from storage fails', async () => {
    session();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: () => { throw new Error('blocked'); },
    });
    auth.disconnectSpotify();
    expect(auth.hasSpotifySession()).toBe(false);
    await expect(auth.getSpotifyAccessToken()).rejects.toThrow('Connect Spotify');
  });
});
