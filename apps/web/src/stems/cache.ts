import { decodePcm16, encodePcm16, MAX_PCM_SCALE, pcmScale, STEM_CHANNEL_COUNT, stemPcmBytes, validateStemChannels } from './pcm';

/** A separate database: cache cleanup never removes original media, classes or models. */
const DB_NAME = 'classtempo-stems';
const STORE = 'separated';
const USAGE_STORE = 'usage';
const FORMAT = 'pcm16-v1';
const CHUNK_FRAMES = 262_144;
export const MAX_STEM_CACHE_BYTES = 500 * 1024 * 1024;

export interface StemCacheAudio {
  /** vocals L/R, drums L/R, bass L/R, other L/R. */
  channels: Float32Array[];
  sampleRate: number;
  frameCount: number;
}

export interface StemCacheSaveResult {
  saved: boolean;
  reason?: string;
}

export interface StemCacheSummary {
  key: string;
  bytes: number;
  lastUsed: number;
}

interface StemCacheRecord extends StemCacheSummary {
  format: typeof FORMAT;
  sampleRate: number;
  frameCount: number;
  scales: number[];
  channels: Blob[];
}

let opening: Promise<IDBDatabase> | null = null;

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Stem operation cancelled.', 'AbortError');
}

async function yieldForInput(signal?: AbortSignal): Promise<void> {
  checkCancelled(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  checkCancelled(signal);
}

/**
 * File bytes, never its name or duration, establish identity. WebCrypto's digest and
 * Blob reads cannot be interrupted; cancellation discards their result. Callers
 * must also guard their current-track generation after every awaited operation.
 */
export async function stemCacheKey(file: File, modelVersion: string, signal?: AbortSignal): Promise<string> {
  checkCancelled(signal);
  if (!modelVersion.trim() || file.size === 0) throw new Error('A non-empty source file and model version are required.');
  if (!globalThis.crypto?.subtle) throw new Error('This browser cannot verify the song for saved stems.');
  const bytes = await file.arrayBuffer();
  checkCancelled(signal);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  checkCancelled(signal);
  const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${FORMAT}:${encodeURIComponent(modelVersion)}:${hex}`;
}

function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser cannot save stems on this device.'));
        return;
      }
      let abandoned = false;
      const request = indexedDB.open(DB_NAME, 2);
      const fail = (error: Error) => { abandoned = true; clearTimeout(timeout); reject(error); };
      const timeout = setTimeout(() => fail(new Error('Stem storage is not responding. Close and reopen the app.')), 15_000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' });
        if (!request.result.objectStoreNames.contains(USAGE_STORE)) request.result.createObjectStore(USAGE_STORE, { keyPath: 'key' });
      };
      request.onerror = () => fail(request.error ?? new Error('Stem storage is unavailable.'));
      request.onblocked = () => fail(new Error('Close other ClassTempo tabs, then try saving stems again.'));
      request.onsuccess = () => {
        clearTimeout(timeout);
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; };
        db.onclose = () => { opening = null; };
        resolve(db);
      };
    }).catch((error: unknown) => { opening = null; throw error; });
  }
  return opening;
}

/** A saved result requires oncomplete, not merely a successful put request. */
export function finishStemTransaction(transaction: IDBTransaction, signal?: AbortSignal, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timeout); signal?.removeEventListener('abort', cancel); };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { transaction.abort(); } catch { /* Already completed or aborted. */ }
      reject(error);
    };
    const cancel = () => fail(new DOMException('Stem operation cancelled.', 'AbortError'));
    const timeout = setTimeout(() => fail(new Error('Saving stems took too long. Close and reopen the app.')), timeoutMs);
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    transaction.onabort = () => fail(transaction.error ?? new Error('Stems could not be saved. Device storage may be full.'));
    transaction.onerror = (event) => fail((event.target as IDBRequest | null)?.error ?? transaction.error ?? new Error('Stem storage failed.'));
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}

/** Replacement does not count twice; eviction and the new entry commit together. */
export function planStemCacheEviction(entries: readonly StemCacheSummary[], incoming: Pick<StemCacheSummary, 'key' | 'bytes'>, maxBytes = MAX_STEM_CACHE_BYTES): string[] | null {
  if (!Number.isSafeInteger(incoming.bytes) || incoming.bytes < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('Invalid stem cache size.');
  if (incoming.bytes > maxBytes) return null;
  const candidates = entries.filter((entry) => entry.key !== incoming.key);
  if (candidates.some((entry) => !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !Number.isFinite(entry.lastUsed))) throw new Error('Invalid stem cache metadata.');
  let total = candidates.reduce((sum, entry) => sum + entry.bytes, incoming.bytes);
  const removed: string[] = [];
  for (const entry of [...candidates].sort((a, b) => a.lastUsed - b.lastUsed || a.key.localeCompare(b.key))) {
    if (total <= maxBytes) break;
    removed.push(entry.key);
    total -= entry.bytes;
  }
  return removed;
}

function validRecord(value: unknown): value is StemCacheRecord {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<StemCacheRecord>;
  if (item.format !== FORMAT || typeof item.key !== 'string' || !item.key.startsWith(`${FORMAT}:`) ||
    !Number.isInteger(item.sampleRate) || item.sampleRate! < 8_000 || item.sampleRate! > 192_000 ||
    !Number.isSafeInteger(item.frameCount) || item.frameCount! < 1 ||
    !Number.isFinite(item.lastUsed) || !Number.isSafeInteger(item.bytes) || item.bytes! > MAX_STEM_CACHE_BYTES ||
    !Array.isArray(item.channels) || item.channels.length !== STEM_CHANNEL_COUNT ||
    !Array.isArray(item.scales) || item.scales.length !== STEM_CHANNEL_COUNT) return false;
  return item.bytes === item.frameCount! * STEM_CHANNEL_COUNT * 2 &&
    item.channels.every((blob) => blob instanceof Blob && blob.size === item.frameCount! * 2) &&
    item.scales.every((scale) => Number.isFinite(scale) && scale >= 1 && scale <= MAX_PCM_SCALE);
}

/** Storage failure keeps the in-memory separation usable, but never reports it saved. */
export async function saveStemCache(key: string, channels: readonly Float32Array[], sampleRate: number, signal?: AbortSignal): Promise<StemCacheSaveResult> {
  try {
    checkCancelled(signal);
    if (!key.startsWith(`${FORMAT}:`)) throw new Error('Invalid stem cache key.');
    const frameCount = validateStemChannels(channels, sampleRate);
    const bytes = stemPcmBytes(frameCount);
    if (bytes > MAX_STEM_CACHE_BYTES) return { saved: false, reason: 'These stems exceed the 500 MB device-cache limit. They are available only until this song is closed.' };
    const db = await database();
    checkCancelled(signal);
    const blobs: Blob[] = [];
    const scales: number[] = [];
    for (const channel of channels) {
      let scale = 1;
      for (let start = 0; start < frameCount; start += CHUNK_FRAMES) {
        scale = Math.max(scale, pcmScale(channel.subarray(start, start + CHUNK_FRAMES)));
        await yieldForInput(signal);
      }
      const parts: ArrayBuffer[] = [];
      for (let start = 0; start < frameCount; start += CHUNK_FRAMES) {
        parts.push(encodePcm16(channel.subarray(start, start + CHUNK_FRAMES), scale));
        await yieldForInput(signal);
      }
      blobs.push(new Blob(parts, { type: 'application/octet-stream' }));
      scales.push(scale);
    }
    checkCancelled(signal);
    const entry: StemCacheRecord = { key, format: FORMAT, channels: blobs, scales, sampleRate, frameCount, bytes, lastUsed: Date.now() };
    const tx = db.transaction([STORE, USAGE_STORE], 'readwrite');
    const done = finishStemTransaction(tx, signal);
    let operationError: unknown;
    try {
      const store = tx.objectStore(STORE);
      const usageStore = tx.objectStore(USAGE_STORE);
      const request = store.getAll() as IDBRequest<unknown[]>;
      request.onsuccess = () => {
        try {
          const records = request.result.filter(validRecord);
          // Malformed old records are disposable derived data, only in this database.
          for (const record of request.result) {
            if (!validRecord(record) && typeof record === 'object' && record !== null && typeof (record as { key?: unknown }).key === 'string') {
              store.delete((record as { key: string }).key);
              usageStore.delete((record as { key: string }).key);
            }
          }
          const usage = usageStore.getAll() as IDBRequest<{ key: string; lastUsed: number }[]>;
          usage.onsuccess = () => {
            try {
              const lastUsed = new Map(usage.result.filter((item) => typeof item.key === 'string' && Number.isFinite(item.lastUsed)).map((item) => [item.key, item.lastUsed]));
              const summaries = records.map((record) => ({ key: record.key, bytes: record.bytes, lastUsed: lastUsed.get(record.key) ?? record.lastUsed }));
              for (const oldKey of planStemCacheEviction(summaries, entry) ?? []) {
                store.delete(oldKey);
                usageStore.delete(oldKey);
              }
              store.put(entry);
              usageStore.put({ key, lastUsed: entry.lastUsed });
            } catch (error) { operationError = error; tx.abort(); }
          };
        } catch (error) { operationError = error; tx.abort(); }
      };
    } catch (error) { operationError = error; try { tx.abort(); } catch { /* Already aborted. */ } }
    await done.catch((error: unknown) => { throw operationError ?? error; });
    return { saved: true };
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    const reason = error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'Device storage is full. These stems are available only until this song is closed.'
      : `${error instanceof Error ? error.message : 'Stems could not be saved on this device.'} These stems have not been saved.`;
    return { saved: false, reason };
  }
}

/** Null means a cache miss/corrupt entry; storage failures reject for honest UI feedback. */
export async function loadStemCache(key: string, signal?: AbortSignal): Promise<StemCacheAudio | null> {
  checkCancelled(signal);
  const db = await database();
  checkCancelled(signal);
  const tx = db.transaction([STORE, USAGE_STORE], 'readwrite');
  const done = finishStemTransaction(tx, signal);
  const store = tx.objectStore(STORE);
  let entry: StemCacheRecord | null = null;
  let operationError: unknown;
  const request = store.get(key) as IDBRequest<unknown>;
  request.onsuccess = () => {
    try {
      if (validRecord(request.result)) {
        entry = request.result;
        // Rewriting an IndexedDB Blob just to touch metadata can invalidate its backing
        // file in WebKit after reload. Keep immutable PCM and tiny usage writes separate.
        tx.objectStore(USAGE_STORE).put({ key, lastUsed: Date.now() });
      } else if (request.result !== undefined) {
        store.delete(key);
        tx.objectStore(USAGE_STORE).delete(key);
      }
    } catch (error) { operationError = error; tx.abort(); }
  };
  await done.catch((error: unknown) => { throw operationError ?? error; });
  checkCancelled(signal);
  // Assignments inside IDB callbacks are not visible to TypeScript control-flow analysis.
  const saved = entry as StemCacheRecord | null;
  if (!saved) return null;
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < STEM_CHANNEL_COUNT; channel++) {
    const blob = saved.channels[channel]!;
    const output = new Float32Array(saved.frameCount);
    for (let start = 0; start < saved.frameCount; start += CHUNK_FRAMES) {
      checkCancelled(signal);
      const data = await blob.slice(start * 2, Math.min(saved.frameCount, start + CHUNK_FRAMES) * 2).arrayBuffer();
      checkCancelled(signal);
      output.set(decodePcm16(data, saved.scales[channel]!), start);
      await yieldForInput(signal);
    }
    channels.push(output);
  }
  return { channels, sampleRate: saved.sampleRate, frameCount: saved.frameCount };
}

export async function removeStemCache(key: string): Promise<void> {
  const db = await database();
  const tx = db.transaction([STORE, USAGE_STORE], 'readwrite');
  const done = finishStemTransaction(tx);
  tx.objectStore(STORE).delete(key);
  tx.objectStore(USAGE_STORE).delete(key);
  await done;
}

export async function clearStemCache(): Promise<void> {
  const db = await database();
  const tx = db.transaction([STORE, USAGE_STORE], 'readwrite');
  const done = finishStemTransaction(tx);
  tx.objectStore(STORE).clear();
  tx.objectStore(USAGE_STORE).clear();
  await done;
}
