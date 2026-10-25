import { describe, expect, it, vi, afterEach } from 'vitest';
import { getAppleMusicConfig, parseAppleMusicConfig } from './config';

describe('Apple Music public configuration', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('accepts a current developer token without returning extra fields', () => {
    expect(parseAppleMusicConfig({ developerToken: 'header.payload.signature', expiresAt: 1200, privateKey: 'never-return' }, 1000))
      .toEqual({ developerToken: 'header.payload.signature', expiresAt: 1200 });
  });

  it('rejects expired, near-expiry and malformed configurations without echoing contents', () => {
    for (const value of [null, {}, { developerToken: 'secret-value', expiresAt: 1200 },
      { developerToken: 'a.b.c', expiresAt: NaN }, { developerToken: 'a.b.c', expiresAt: 1060 }]) {
      expect(() => parseAppleMusicConfig(value, 1000)).toThrow(/Apple Music/);
    }
  });

  it('fetches without a cache and distinguishes missing setup from a network failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(getAppleMusicConfig()).rejects.toThrow('awaiting developer account setup');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    fetcher.mockRejectedValue(new Error('sensitive URL'));
    await expect(getAppleMusicConfig()).rejects.toThrow('Connect to the internet');
  });

  it('aborts a stalled configuration request so setup remains recoverable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })));
    const result = expect(getAppleMusicConfig()).rejects.toThrow('Connect to the internet');
    await vi.advanceTimersByTimeAsync(15_000);
    await result;
  });
});
