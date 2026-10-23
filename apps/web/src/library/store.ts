import { isVideoFile } from '../dancer/media';
import { requestPersistentStorage } from '../platform/persist';
import { normalizePracticeSettings, type PracticeSettings } from '../practice/settings';

export interface LibraryMedia {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  kind: 'audio' | 'video';
  addedAt: number;
  openedAt: number;
  /** False for metadata restored from a backup until its file is imported again. */
  available: boolean;
}

export interface ClassEntry {
  /** Each occurrence has its own ID so a song may appear twice in one class. */
  id: string;
  mediaId: string;
  /** Optional teaching label and reminder, independent of the original filename. */
  name?: string;
  note?: string;
  /** Optional exercise-specific snapshot; the same media can have a different tempo in another entry. */
  practice?: PracticeSettings;
  practiceDuration?: number;
}

export interface ClassSet {
  id: string;
  name: string;
  entries: ClassEntry[];
  /** Continue after a completed exercise; missing/false waits for the teacher. */
  autoNext?: boolean;
  updatedAt: number;
}

const DB_NAME = 'classtempo-library';
const DB_VERSION = 1;
let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser cannot save a local library. You can still load files directly.'));
        return;
      }
      let abandoned = false;
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      const timeout = setTimeout(() => {
        abandoned = true;
        reject(new Error('Device storage is not responding. Close and reopen the app, or open a file directly.'));
      }, 15_000);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('media', { keyPath: 'id' });
        db.createObjectStore('files');
        db.createObjectStore('classes', { keyPath: 'id' });
      };
      request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new Error('Local library storage is unavailable.')); };
      request.onblocked = () => { abandoned = true; clearTimeout(timeout); reject(new Error('Close other ClassTempo tabs, then try opening the library again.')); };
      request.onsuccess = () => {
        const db = request.result;
        clearTimeout(timeout);
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    }).catch((error: unknown) => { opening = null; throw error; });
  }
  return opening;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { request.transaction?.abort(); } catch { /* The transaction may already have finished. */ }
      reject(new Error('Device storage is not responding. Close and reopen the app, then try again.'));
    }, 15_000);
    request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
    request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new Error('Could not read the local library.')); };
  });
}

/** Abort explicitly on request errors: WebKit can otherwise leave a failed Blob transaction holding its locks. */
export function finishStorageTransaction(transaction: IDBTransaction, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: DOMException | Error) => {
      clearTimeout(timeout);
      try { transaction.abort(); } catch { /* Already aborted or completed. */ }
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error('Saving to device storage took too long. Close and reopen the app, then try again.')), timeoutMs);
    transaction.oncomplete = () => { clearTimeout(timeout); resolve(); };
    transaction.onabort = () => { clearTimeout(timeout); reject(transaction.error ?? new Error('Could not save the local library. Storage may be full.')); };
    transaction.onerror = (event) => {
      const request = event.target as IDBRequest | null;
      fail(request?.error ?? transaction.error ?? new Error('Could not save the local library. Storage may be full.'));
    };
  });
}

export function newId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Metadata identity avoids reading a second copy of a large video into memory. */
export function mediaId(file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>): string {
  return `file:${encodeURIComponent(file.name)}|${file.size}|${file.lastModified}|${encodeURIComponent(file.type)}`;
}

/** Resolves only after the file and its metadata have committed together. */
export async function saveMedia(file: File): Promise<LibraryMedia> {
  if (file.size === 0 || (!/^(audio|video)\//i.test(file.type) && !/\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|opus|mp4|mov|m4v|webm)$/i.test(file.name))) {
    throw new Error('Choose a non-empty audio or video file.');
  }
  const db = await database();
  const previous = await listMedia();
  const exact = previous.find((item) => item.id === mediaId(file));
  // Relink restored metadata when a picker has changed the modification time.
  const restored = previous.find((item) => !item.available && item.name === file.name && item.size === file.size && item.kind === (isVideoFile(file) ? 'video' : 'audio'));
  const old = exact ?? restored;
  const media: LibraryMedia = {
    id: old?.id ?? mediaId(file), name: file.name, type: file.type, size: file.size,
    lastModified: file.lastModified, kind: isVideoFile(file) ? 'video' : 'audio',
    addedAt: old?.addedAt ?? Date.now(), openedAt: old?.openedAt ?? 0, available: true,
  };
  const transaction = db.transaction(['media', 'files'], 'readwrite');
  const done = finishStorageTransaction(transaction, 60_000);
  try {
    transaction.objectStore('media').put(media);
    transaction.objectStore('files').put(file, media.id);
  } catch (error) {
    // A synchronous Blob-clone/quota error must not commit the already queued availability metadata.
    transaction.abort();
    await done.catch(() => {});
    throw error;
  }
  await done;
  void requestPersistentStorage();
  return media;
}

export async function listMedia(): Promise<LibraryMedia[]> {
  const db = await database();
  const request = db.transaction('media').objectStore('media').getAll() as IDBRequest<LibraryMedia[]>;
  return (await result(request)).sort((a, b) => b.openedAt - a.openedAt || b.addedAt - a.addedAt);
}

export async function getMediaFile(id: string): Promise<File> {
  const db = await database();
  const tx = db.transaction(['media', 'files']);
  const [metadata, blob] = await Promise.all([
    result(tx.objectStore('media').get(id) as IDBRequest<LibraryMedia | undefined>),
    result(tx.objectStore('files').get(id) as IDBRequest<Blob | undefined>),
  ]);
  if (!metadata || !blob) throw new Error('This file is not saved on this device. Import it again to reconnect its class entries.');
  return new File([blob], metadata.name, { type: metadata.type, lastModified: metadata.lastModified });
}

export async function markOpened(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction('media', 'readwrite');
  const done = finishStorageTransaction(tx);
  const store = tx.objectStore('media');
  const request = store.get(id) as IDBRequest<LibraryMedia | undefined>;
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, openedAt: Date.now() });
  };
  await done;
}

/** Remove the stored file but retain a placeholder so prepared classes do not lose their order. */
export async function removeMedia(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction(['media', 'files'], 'readwrite');
  const done = finishStorageTransaction(tx);
  tx.objectStore('files').delete(id);
  const store = tx.objectStore('media');
  const request = store.get(id) as IDBRequest<LibraryMedia | undefined>;
  request.onsuccess = () => {
    if (request.result) store.put({ ...request.result, available: false });
  };
  await done;
}

export async function listClasses(): Promise<ClassSet[]> {
  const db = await database();
  const request = db.transaction('classes').objectStore('classes').getAll() as IDBRequest<ClassSet[]>;
  return (await result(request)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function normalizeClass(value: unknown): ClassSet | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ClassSet>;
  if (typeof item.id !== 'string' || !item.id || item.id.length > 200 || typeof item.name !== 'string' || !item.name.trim() || !Array.isArray(item.entries)) return null;
  const seen = new Set<string>();
  const entries: ClassEntry[] = [];
  for (const value of item.entries.slice(0, 2000)) {
    if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !value.id || value.id.length > 200 || seen.has(value.id) || typeof value.mediaId !== 'string' || !value.mediaId || value.mediaId.length > 3000) continue;
    seen.add(value.id);
    const entry: ClassEntry = { id: value.id, mediaId: value.mediaId };
    if (typeof value.name === 'string' && value.name.trim()) entry.name = value.name.trim().slice(0, 100);
    if (typeof value.note === 'string' && value.note.trim()) entry.note = value.note.trim().slice(0, 500);
    if (value.practice && typeof value.practice === 'object' && typeof value.practiceDuration === 'number' && Number.isFinite(value.practiceDuration) && value.practiceDuration > 0 && value.practiceDuration <= 86_400) {
      entry.practiceDuration = value.practiceDuration;
      entry.practice = normalizePracticeSettings(value.practice, value.practiceDuration);
    }
    entries.push(entry);
  }
  return { id: item.id, name: item.name.trim().slice(0, 100), entries, autoNext: item.autoNext === true,
    updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? Math.max(0, item.updatedAt) : 0 };
}

export function moveClassEntry(entries: readonly ClassEntry[], id: string, offset: -1 | 1): ClassEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const next = index + offset;
  const copy = [...entries];
  if (index < 0 || next < 0 || next >= copy.length) return copy;
  [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  return copy;
}

export async function saveClass(value: ClassSet): Promise<ClassSet> {
  const normalized = normalizeClass(value);
  if (!normalized) throw new Error('Give your class a name before saving it.');
  const item = { ...normalized, updatedAt: Date.now() };
  const db = await database();
  const tx = db.transaction('classes', 'readwrite');
  const done = finishStorageTransaction(tx);
  tx.objectStore('classes').put(item);
  await done;
  return item;
}

export async function removeClass(id: string): Promise<void> {
  const db = await database();
  const tx = db.transaction('classes', 'readwrite');
  const done = finishStorageTransaction(tx);
  tx.objectStore('classes').delete(id);
  await done;
}

export interface LibraryBackup {
  format: 'classtempo-library';
  version: 1;
  exportedAt: string;
  media: LibraryMedia[];
  classes: ClassSet[];
  settings: Record<string, string>;
}

const SETTINGS_PREFIXES = ['mixdeck.dancer.cues.', 'mixdeck.practice.'];

function normalizeMedia(value: unknown): LibraryMedia | null {
  if (!value || typeof value !== 'object') return null;
  const media = value as Partial<LibraryMedia>;
  if (typeof media.id !== 'string' || !media.id || media.id.length > 3000 || typeof media.name !== 'string' || !media.name || media.name.length > 1000 || typeof media.type !== 'string' || typeof media.size !== 'number' || !Number.isFinite(media.size) || media.size < 0 || (media.kind !== 'audio' && media.kind !== 'video')) return null;
  const time = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  return { id: media.id, name: media.name, type: media.type.slice(0, 200), size: media.size, lastModified: time(media.lastModified), kind: media.kind, addedAt: time(media.addedAt), openedAt: time(media.openedAt), available: false };
}

/** Accept only our versioned metadata format; restored files are always marked unavailable. */
export function parseBackup(text: string): LibraryBackup {
  if (text.length > 5_000_000) throw new Error('This backup is too large. Choose a ClassTempo settings backup under 5 MB.');
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('This is not a ClassTempo settings backup.');
  const value = raw as Partial<LibraryBackup>;
  if (value.format !== 'classtempo-library' || value.version !== 1 || !Array.isArray(value.media) || !Array.isArray(value.classes) || !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings)) throw new Error('This is not a supported ClassTempo settings backup.');
  if (value.media.length > 5000 || value.classes.length > 1000) throw new Error('This backup contains too many library items.');
  const media = value.media.map(normalizeMedia);
  const classes = value.classes.map(normalizeClass);
  if (media.some((item) => !item) || classes.some((item) => !item)) throw new Error('This backup contains invalid library or class data.');
  const mediaIds = new Set(media.map((item) => item!.id));
  if (mediaIds.size !== media.length || new Set(classes.map((item) => item!.id)).size !== classes.length || classes.some((item) => item!.entries.some((entry) => !mediaIds.has(entry.mediaId)))) throw new Error('This backup contains duplicate or missing library references.');
  const settings: Record<string, string> = {};
  for (const [key, setting] of Object.entries(value.settings)) {
    if (!SETTINGS_PREFIXES.some((prefix) => key.startsWith(prefix)) || key.length > 1500 || typeof setting !== 'string' || setting.length > 100_000) continue;
    try {
      const decoded: unknown = JSON.parse(setting);
      if (!decoded || typeof decoded !== 'object') continue;
      settings[key] = setting;
    } catch { /* Ignore corrupt settings without blocking intact classes. */ }
  }
  return { format: 'classtempo-library', version: 1, exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '', media: media as LibraryMedia[], classes: classes as ClassSet[], settings };
}

export async function createBackup(): Promise<LibraryBackup> {
  const [media, classes] = await Promise.all([listMedia(), listClasses()]);
  const settings: Record<string, string> = {};
  // If localStorage is blocked, fail honestly instead of exporting an apparently complete backup.
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && SETTINGS_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      const value = localStorage.getItem(key);
      if (value !== null) settings[key] = value;
    }
  }
  return { format: 'classtempo-library', version: 1, exportedAt: new Date().toISOString(), media: media.map((item) => ({ ...item, available: false })), classes, settings };
}

/** Merge without replacing saved files, classes with matching IDs, or existing practice/cue settings. */
export async function restoreBackup(backup: LibraryBackup): Promise<{ classes: number; settings: number; skippedSettings: number }> {
  const db = await database();
  const tx = db.transaction(['media', 'classes'], 'readwrite');
  const done = finishStorageTransaction(tx);
  let addedClasses = 0;
  // Check inside the write transaction. A prior list/read can become stale while an import or another tab saves.
  const mediaStore = tx.objectStore('media');
  for (const item of backup.media) {
    const request = mediaStore.get(item.id) as IDBRequest<LibraryMedia | undefined>;
    request.onsuccess = () => { if (!request.result) mediaStore.put({ ...item, available: false }); };
  }
  const classStore = tx.objectStore('classes');
  for (const item of backup.classes) {
    const request = classStore.get(item.id) as IDBRequest<ClassSet | undefined>;
    request.onsuccess = () => {
      if (!request.result) { classStore.put(item); addedClasses++; }
    };
  }
  await done;
  let count = 0;
  let skipped = 0;
  try {
    for (const [key, value] of Object.entries(backup.settings)) {
      if (localStorage.getItem(key) !== null) { skipped++; continue; }
      localStorage.setItem(key, value); count++;
    }
  } catch {
    throw new Error('Classes were restored, but some cue or practice settings could not be saved. Free device storage and import again.');
  }
  return { classes: addedClasses, settings: count, skippedSettings: skipped };
}
