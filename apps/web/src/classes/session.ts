import { getMediaFile, type ClassEntry, type ClassSet, type LibraryMedia } from '../library/store';

export const CLASS_RESUME_STORAGE_KEY = 'classtempo.class-session.v1';

/** A saved location only. Restoring it must load the exercise paused, never start playback. */
export interface ClassResume {
  classId: string;
  entryId: string;
  position: number;
  autoNext: boolean;
  finished: boolean;
}

export interface ClassResumeLoadResult {
  resume: ClassResume | null;
  error?: string;
}

export interface ClassResumeSaveResult {
  saved: boolean;
  error?: string;
}

export interface ClassResumeClearResult {
  cleared: boolean;
  error?: string;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim().length > 0;
}

/** Actual track duration and continued class/entry existence must be checked when loading media. */
export function normalizeClassResume(value: unknown): ClassResume | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<ClassResume>;
  if (!validId(item.classId) || !validId(item.entryId) || typeof item.position !== 'number' ||
    !Number.isFinite(item.position) || item.position < 0 || typeof item.autoNext !== 'boolean' ||
    (item.finished !== undefined && typeof item.finished !== 'boolean')) return null;
  return { classId: item.classId, entryId: item.entryId, position: item.position,
    autoNext: item.autoNext, finished: item.finished ?? false };
}

export function loadClassResume(storage?: Pick<Storage, 'getItem'>): ClassResumeLoadResult {
  try {
    const text = (storage ?? localStorage).getItem(CLASS_RESUME_STORAGE_KEY);
    if (text === null) return { resume: null };
    const resume = normalizeClassResume(JSON.parse(text));
    if (!resume) throw new Error('Invalid class progress');
    return { resume };
  } catch {
    return { resume: null, error: 'Saved class progress could not be read. Choose a class to start again.' };
  }
}

export function saveClassResume(value: ClassResume, storage?: Pick<Storage, 'setItem'>): ClassResumeSaveResult {
  const resume = normalizeClassResume(value);
  if (!resume) return { saved: false, error: 'Class progress was invalid and was not saved.' };
  try {
    (storage ?? localStorage).setItem(CLASS_RESUME_STORAGE_KEY, JSON.stringify(resume));
    return { saved: true };
  } catch {
    return { saved: false, error: 'Your class progress could not be saved on this device.' };
  }
}

/** Ending a session removes only its resume location. The saved class and its exercises remain. */
export function clearClassResume(storage?: Pick<Storage, 'removeItem'>): ClassResumeClearResult {
  try {
    (storage ?? localStorage).removeItem(CLASS_RESUME_STORAGE_KEY);
    return { cleared: true };
  } catch {
    return { cleared: false, error: 'Saved class progress could not be cleared on this device.' };
  }
}

/** Entry identity matters: two exercises using the same media are still separate class steps. */
export function findNextClassEntry(entries: readonly ClassEntry[], currentEntryId: string): ClassEntry | null {
  const index = entries.findIndex((entry) => entry.id === currentEntryId);
  return index < 0 ? null : entries[index + 1] ?? null;
}

export function getClassEntryLabel(
  entry: ClassEntry & { name?: string },
  media?: Pick<LibraryMedia, 'name'>,
): string {
  return entry.name?.trim() || media?.name.trim() || 'Unavailable media';
}

export interface MissingClassFile {
  mediaId: string;
  /** All affected occurrences, in class order. */
  entryIds: string[];
  label: string;
  reason: string;
}

export interface ClassFilePreflight {
  ready: boolean;
  missing: MissingClassFile[];
  checkedMediaCount: number;
}

export interface ClassFilePreflightOptions {
  loadFile?: (mediaId: string) => Promise<File>;
  signal?: AbortSignal;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Class check cancelled', 'AbortError');
}

/**
 * Check each actual saved file once, sequentially. Metadata availability alone proves nothing after
 * backup restore or storage eviction. Reading one byte checks access without decoding/retaining songs;
 * readiness does not promise codec support. A cancelled check never returns a partial success result.
 */
export async function preflightClassFiles(
  classSet: Pick<ClassSet, 'entries'>,
  media: readonly LibraryMedia[],
  { loadFile = getMediaFile, signal }: ClassFilePreflightOptions = {},
): Promise<ClassFilePreflight> {
  checkAborted(signal);
  const metadata = new Map(media.map((item) => [item.id, item]));
  const entriesByMedia = new Map<string, ClassEntry[]>();
  for (const entry of classSet.entries) {
    const entries = entriesByMedia.get(entry.mediaId) ?? [];
    entries.push(entry);
    entriesByMedia.set(entry.mediaId, entries);
  }
  const missing: MissingClassFile[] = [];
  let checkedMediaCount = 0;
  for (const [mediaId, entries] of entriesByMedia) {
    checkAborted(signal);
    try {
      const file = await loadFile(mediaId);
      checkAborted(signal);
      if (file.size === 0) throw new Error('The saved file is empty. Import it again.');
      await file.slice(0, 1).arrayBuffer();
      checkAborted(signal);
    } catch (error) {
      checkAborted(signal);
      missing.push({ mediaId, entryIds: entries.map((entry) => entry.id),
        label: getClassEntryLabel(entries[0]!, metadata.get(mediaId)),
        reason: error instanceof Error ? error.message : 'This file could not be opened on this device. Import it again.' });
    }
    checkedMediaCount++;
  }
  return { ready: classSet.entries.length > 0 && missing.length === 0, missing, checkedMediaCount };
}
