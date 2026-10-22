import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Fresh module per test: the request is memoised for the page's lifetime. */
async function load() {
  vi.resetModules();
  return (await import('./persist')).requestPersistentStorage;
}

describe('requestPersistentStorage', () => {
  let persist: ReturnType<typeof vi.fn>;
  let persisted: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    persist = vi.fn(async () => true);
    persisted = vi.fn(async () => false);
    vi.stubGlobal('navigator', { storage: { persist, persisted } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks once and shares the result', async () => {
    const request = await load();
    const first = request();
    expect(request()).toBe(first);
    await expect(first).resolves.toBe(true);
    await request();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask again when already persisted', async () => {
    persisted.mockResolvedValue(true);
    const request = await load();
    await expect(request()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('resolves false when refused, rejected or unsupported', async () => {
    persist.mockResolvedValue(false);
    await expect((await load())()).resolves.toBe(false);

    persist.mockRejectedValue(new Error('nope'));
    await expect((await load())()).resolves.toBe(false);

    vi.stubGlobal('navigator', {});
    await expect((await load())()).resolves.toBe(false);
  });
});
