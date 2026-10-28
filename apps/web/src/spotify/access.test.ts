import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'classtempo.spotify.tester.v1';
const base = 'https://example.com/classtempo/';
let persistent: Map<string, string>;
let temporary: Map<string, string>;
let browserLocation: { href: string };
let access: typeof import('./access');

function store(values: Map<string, string>): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  return {
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value); },
    removeItem: (name: string) => { values.delete(name); },
  };
}

function blocked(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const fail = () => { throw new Error('Storage blocked'); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

async function reload(): Promise<void> {
  vi.resetModules();
  access = await import('./access');
}

describe('Spotify private tester discovery', () => {
  beforeEach(async () => {
    vi.stubEnv('BASE_URL', '/classtempo/');
    persistent = new Map();
    temporary = new Map();
    vi.stubGlobal('localStorage', store(persistent));
    vi.stubGlobal('sessionStorage', store(temporary));
    browserLocation = { href: base };
    vi.stubGlobal('location', browserLocation);
    vi.stubGlobal('history', {
      state: { player: 'keep' },
      replaceState: vi.fn((_state: unknown, _title: string, url: string) => {
        browserLocation.href = new URL(url, browserLocation.href).href;
      }),
    });
    vi.stubGlobal('fetch', vi.fn());
    await reload();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('starts hidden and does not enable Spotify from the ordinary route or account records', () => {
    browserLocation.href = base + '#spotify';
    temporary.set('classtempo.spotify.session.v1', '{"accessToken":"not-a-discovery-grant"}');
    temporary.set('classtempo.spotify.pkce.v1', '{"state":"not-a-discovery-grant"}');
    expect(access.acceptSpotifyTesterInvite()).toBe(false);
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('consumes an invite, preserves the surrounding URL/history and remembers the browser after reload', async () => {
    browserLocation.href = base + '?campaign=invited#spotify-invite';
    expect(access.acceptSpotifyTesterInvite()).toBe(true);
    expect(browserLocation.href).toBe(base + '?campaign=invited#spotify');
    expect(history.replaceState).toHaveBeenCalledWith({ player: 'keep' }, '', '/classtempo/?campaign=invited#spotify');
    expect(access.hasSpotifyTesterAccess()).toBe(true);
    expect(persistent.get(key)).toBe('1');
    temporary.clear();
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(true);
    expect(access.acceptSpotifyTesterInvite()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['', '#apple-music', '#stems-benchmark', '#spotify-invite-extra', '#SPOTIFY-INVITE'])('leaves the unrelated route %j unchanged', hash => {
    const url = base + hash;
    browserLocation.href = url;
    expect(access.acceptSpotifyTesterInvite()).toBe(false);
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(browserLocation.href).toBe(url);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it.each(['true', 'yes', '2', '{"enabled":true}', '1 '])('does not recognize an invalid marker %j', marker => {
    persistent.set(key, marker);
    expect(access.hasSpotifyTesterAccess()).toBe(false);
  });

  it('uses tab storage when persistent storage is blocked and survives its OAuth reload', async () => {
    vi.stubGlobal('localStorage', blocked());
    browserLocation.href = base + '#spotify-invite';
    expect(access.acceptSpotifyTesterInvite()).toBe(true);
    expect(temporary.get(key)).toBe('1');
    browserLocation.href = base + '?code=returned&state=classtempo-spotify-test';
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an explicit invite usable only in the current document when both stores are blocked', async () => {
    vi.stubGlobal('localStorage', blocked());
    vi.stubGlobal('sessionStorage', blocked());
    browserLocation.href = base + '#spotify-invite';
    expect(access.acceptSpotifyTesterInvite()).toBe(true);
    expect(access.hasSpotifyTesterAccess()).toBe(true);
    access.revokeSpotifyTesterAccess();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
  });

  it('does not grant an invite that cannot be consumed safely', () => {
    browserLocation.href = base + '#spotify-invite';
    vi.mocked(history.replaceState).mockImplementation(() => { throw new Error('History blocked'); });
    expect(access.acceptSpotifyTesterInvite()).toBe(false);
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(persistent.has(key)).toBe(false);
    expect(temporary.has(key)).toBe(false);
  });

  it('revokes discovery without changing unrelated files, account credentials or cues', async () => {
    browserLocation.href = base + '#spotify-invite';
    persistent.set('mixdeck.dancer.cues.song', 'keep');
    temporary.set('classtempo.spotify.session.v1', 'keep-credential');
    access.acceptSpotifyTesterInvite();
    access.revokeSpotifyTesterAccess();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(persistent.get('mixdeck.dancer.cues.song')).toBe('keep');
    expect(temporary.get('classtempo.spotify.session.v1')).toBe('keep-credential');
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(access.acceptSpotifyTesterInvite()).toBe(false);
  });

  it('revokes a read-only stale grant in memory and through the writable fallback after reload', async () => {
    persistent.set(key, '1');
    expect(access.hasSpotifyTesterAccess()).toBe(true);
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => persistent.get(name) ?? null,
      setItem: () => { throw new Error('Read-only'); },
      removeItem: () => { throw new Error('Read-only'); },
    });
    access.revokeSpotifyTesterAccess();
    expect(persistent.get(key)).toBe('1');
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
  });

  it('leaves a disabled tombstone when deletion fails, preventing a stale second-store grant on reload', async () => {
    persistent.set(key, '1');
    temporary.set(key, '1');
    vi.stubGlobal('localStorage', {
      ...store(persistent),
      removeItem: () => { throw new Error('Deletion blocked'); },
    });
    vi.stubGlobal('sessionStorage', {
      ...store(temporary),
      setItem: () => { throw new Error('Read-only'); },
      removeItem: () => { throw new Error('Read-only'); },
    });
    access.revokeSpotifyTesterAccess();
    expect(persistent.get(key)).toBe('0');
    expect(temporary.get(key)).toBe('1');
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(false);
  });

  it('allows a new explicit invitation after revocation', async () => {
    access.revokeSpotifyTesterAccess();
    browserLocation.href = base + '#spotify-invite';
    expect(access.acceptSpotifyTesterInvite()).toBe(true);
    await reload();
    expect(access.hasSpotifyTesterAccess()).toBe(true);
  });

  it('shares only the canonical app invite without OAuth, tracking or personal query fields', () => {
    browserLocation.href = base + '?code=private-code&state=private-state&ubi=tracking&email=private#spotify';
    expect(access.spotifyTesterInviteUrl()).toBe(base + '#spotify-invite');
    expect(access.hasSpotifyTesterAccess()).toBe(false);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it('preserves the deployed app path with the relative Vite base used by production', () => {
    vi.stubEnv('BASE_URL', './');
    browserLocation.href = base + '?code=private-code&state=private-state&ubi=tracking#spotify';
    expect(access.spotifyTesterInviteUrl()).toBe(base + '#spotify-invite');
  });
});
