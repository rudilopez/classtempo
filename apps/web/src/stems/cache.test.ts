import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishStemTransaction, loadStemCache, planStemCacheEviction, saveStemCache, stemCacheKey } from './cache';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('stem cache identity and eviction', () => {
  it('keys identical content together regardless of filename and invalidates changed content/model', async () => {
    const first = new File(['same audio'], 'lesson.wav');
    const renamed = new File(['same audio'], 'renamed.wav');
    const changed = new File(['new audio!'], 'lesson.wav');
    const key = await stemCacheKey(first, 'model:r1');
    expect(key).toMatch(/^pcm16-v1:model%3Ar1:[0-9a-f]{64}$/);
    expect(await stemCacheKey(renamed, 'model:r1')).toBe(key);
    expect(await stemCacheKey(changed, 'model:r1')).not.toBe(key);
    expect(await stemCacheKey(first, 'model:r2')).not.toBe(key);
  });

  it('discards a hash result when its source selection is cancelled during the read', async () => {
    const controller = new AbortController();
    let resolveRead!: (buffer: ArrayBuffer) => void;
    const file = { size: 4, arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { resolveRead = resolve; }) } as File;
    const pending = stemCacheKey(file, 'v1', controller.signal);
    controller.abort();
    resolveRead(new ArrayBuffer(4));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('evicts oldest use first, preserves replacement identity and never mutates the list', () => {
    const entries = [
      { key: 'recent', bytes: 40, lastUsed: 30 },
      { key: 'oldest', bytes: 30, lastUsed: 10 },
      { key: 'middle', bytes: 30, lastUsed: 20 },
    ];
    expect(planStemCacheEviction(entries, { key: 'new', bytes: 45 }, 100)).toEqual(['oldest', 'middle']);
    expect(planStemCacheEviction(entries, { key: 'recent', bytes: 40 }, 100)).toEqual([]);
    expect(planStemCacheEviction(entries, { key: 'recent', bytes: 50 }, 100)).toEqual(['oldest']);
    expect(entries.map((entry) => entry.key)).toEqual(['recent', 'oldest', 'middle']);
  });

  it('declines an oversized item without offering destructive evictions', () => {
    expect(planStemCacheEviction([{ key: 'old', bytes: 10, lastUsed: 0 }], { key: 'new', bytes: 101 }, 100)).toBeNull();
    expect(() => planStemCacheEviction([], { key: 'new', bytes: NaN })).toThrow('Invalid');
    expect(() => planStemCacheEviction([{ key: 'bad', bytes: -10, lastUsed: 0 }], { key: 'new', bytes: 10 })).toThrow('Invalid');
  });

  it('reports unavailable storage honestly and distinguishes a failure from a cache miss', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const channels = Array.from({ length: 8 }, () => new Float32Array([0, 0.5]));
    await expect(saveStemCache('pcm16-v1:model:hash', channels, 44_100)).resolves.toMatchObject({ saved: false, reason: expect.stringContaining('cannot save') });
    await expect(loadStemCache('pcm16-v1:model:hash')).rejects.toThrow('cannot save');
  });

  it('does not open storage for an already cancelled request', async () => {
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    const controller = new AbortController();
    controller.abort();
    const channels = Array.from({ length: 8 }, () => new Float32Array([0]));
    await expect(saveStemCache('pcm16-v1:model:hash', channels, 44_100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loadStemCache('pcm16-v1:model:hash', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(open).not.toHaveBeenCalled();
  });

  it('updates cache usage without rewriting stored Blob handles during reads', async () => {
    // Re-putting an IndexedDB Blob record to change lastUsed breaks subsequent WebKit
    // reads after reload. Real-browser regression covers reload; this guards the write boundary.
    const putAudio = vi.fn();
    const putUsage = vi.fn();
    const record = {
      key: 'pcm16-v1:model:hash', format: 'pcm16-v1', sampleRate: 44_100, frameCount: 1,
      bytes: 16, lastUsed: 1, scales: Array(8).fill(1),
      channels: Array.from({ length: 8 }, () => new Blob([new Uint8Array([0, 0])])),
    };
    const tx = { error: null, abort: vi.fn(), oncomplete: null, onerror: null, onabort: null } as unknown as IDBTransaction;
    const audioStore = {
      put: putAudio,
      get: () => {
        const request = { result: record, onsuccess: null } as unknown as IDBRequest;
        queueMicrotask(() => {
          request.onsuccess?.call(request, new Event('success'));
          queueMicrotask(() => tx.oncomplete?.call(tx, new Event('complete')));
        });
        return request;
      },
    };
    tx.objectStore = (name: string) => (name === 'separated' ? audioStore : { put: putUsage }) as unknown as IDBObjectStore;
    const db = { transaction: () => tx } as unknown as IDBDatabase;
    vi.stubGlobal('indexedDB', { open: () => {
      const request = { result: db, onsuccess: null } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
      return request;
    } });
    vi.resetModules();
    const fresh = await import('./cache');
    const loaded = await fresh.loadStemCache(record.key);
    expect(loaded?.channels).toHaveLength(8);
    expect(putAudio).not.toHaveBeenCalled();
    expect(putUsage).toHaveBeenCalledExactlyOnceWith({ key: record.key, lastUsed: expect.any(Number) });
  });
});

describe('atomic stem cache transaction lifecycle', () => {
  function transaction(): IDBTransaction {
    return { error: null, abort: vi.fn(), oncomplete: null, onerror: null, onabort: null } as unknown as IDBTransaction;
  }

  it('aborts writes on cancellation and releases its deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const tx = transaction();
    const done = finishStemTransaction(tx, controller.signal);
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(tx.abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves a quota failure and explicitly aborts so eviction cannot commit separately', async () => {
    const tx = transaction();
    const done = finishStemTransaction(tx);
    const error = new DOMException('No room for this Blob', 'QuotaExceededError');
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: { error } });
    tx.onerror?.call(tx, event);
    await expect(done).rejects.toBe(error);
    expect(tx.abort).toHaveBeenCalledOnce();
  });

  it('times out stalled writes, but does not abort a completed save', async () => {
    vi.useFakeTimers();
    const stalled = transaction();
    const pending = finishStemTransaction(stalled, undefined, 100);
    const failed = expect(pending).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(stalled.abort).toHaveBeenCalledOnce();
    const completed = transaction();
    const controller = new AbortController();
    const done = finishStemTransaction(completed, controller.signal, 100);
    completed.oncomplete?.call(completed, new Event('complete'));
    await done;
    controller.abort();
    await vi.advanceTimersByTimeAsync(100);
    expect(completed.abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
