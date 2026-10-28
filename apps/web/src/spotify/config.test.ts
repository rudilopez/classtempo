import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpotifyConfig } from './config';

const clientId = 'a'.repeat(32);

describe('Spotify public configuration', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', clientId);
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', '');
    vi.stubEnv('BASE_URL', '/classtempo/');
    vi.stubGlobal('location', { href: 'https://example.com/classtempo/?campaign=one#spotify' });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('uses the deployed app base without query or hash', () => {
    expect(getSpotifyConfig()).toEqual({ clientId, redirectUri: 'https://example.com/classtempo/' });
  });

  it('accepts an explicitly configured same-origin callback', () => {
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', 'https://example.com/classtempo/callback');
    expect(getSpotifyConfig()?.redirectUri).toBe('https://example.com/classtempo/callback');
  });

  it.each(['', 'a b', 'secret\nvalue', 'x'.repeat(129)])('disables missing or invalid client id %j', value => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', value);
    expect(getSpotifyConfig()).toBeNull();
  });

  it.each([
    'https://other.example.com/callback', 'http://example.com/classtempo/',
    'https://user:password@example.com/classtempo/', 'javascript:alert(1)', '/relative',
    'https://example.com/classtempo/#spotify', 'https://example.com/classtempo/?code=anything',
  ])('rejects unsafe or ambiguous redirects %j', redirect => {
    vi.stubEnv('VITE_SPOTIFY_REDIRECT_URI', redirect);
    expect(getSpotifyConfig()).toBeNull();
  });

  it('permits explicit loopback IP HTTP, but not localhost', () => {
    vi.stubGlobal('location', { href: 'http://127.0.0.1:5173/classtempo/#spotify' });
    expect(getSpotifyConfig()?.redirectUri).toBe('http://127.0.0.1:5173/classtempo/');
    vi.stubGlobal('location', { href: 'http://localhost:5173/classtempo/#spotify' });
    expect(getSpotifyConfig()).toBeNull();
    vi.stubGlobal('location', { href: 'http://[::1]:5173/classtempo/#spotify' });
    expect(getSpotifyConfig()?.redirectUri).toBe('http://[::1]:5173/classtempo/');
  });

  it('does not require browser globals until configuration is requested', () => {
    vi.stubGlobal('location', undefined);
    expect(getSpotifyConfig()).toBeNull();
  });
});
