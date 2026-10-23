import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClassEntry, LibraryMedia } from '../library/store';
import {
  CLASS_RESUME_STORAGE_KEY, clearClassResume, findNextClassEntry, getClassEntryLabel, loadClassResume,
  normalizeClassResume, preflightClassFiles, saveClassResume, type ClassResume,
} from './session';

const resume = (): ClassResume => ({ classId: 'tuesday', entryId: 'warmup', position: 31.5, autoNext: true, finished: false });
const entries: ClassEntry[] = [
  { id: 'warmup', mediaId: 'song' }, { id: 'turn', mediaId: 'video' }, { id: 'again', mediaId: 'song' },
];
const media = (id: string, available = true): LibraryMedia => ({ id, name: `${id}.wav`, type: 'audio/wav', size: 4,
  lastModified: 0, kind: 'audio', addedAt: 0, openedAt: 0, available });

afterEach(() => vi.unstubAllGlobals());

describe('class session progress', () => {
  it('roundtrips only a resume location and never stores playback permission', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(loadClassResume(storage)).toEqual({ resume: null });
    expect(saveClassResume({ ...resume(), playing: true } as ClassResume, storage)).toEqual({ saved: true });
    expect(loadClassResume(storage)).toEqual({ resume: resume() });
    expect(JSON.parse(values.get(CLASS_RESUME_STORAGE_KEY)!)).not.toHaveProperty('playing');
  });

  it('rejects malformed saved progress while safely defaulting an omitted finished flag', () => {
    for (const invalid of [null, [], 5, { ...resume(), classId: '' }, { ...resume(), entryId: ' ' },
      { ...resume(), classId: 'a'.repeat(201) }, { ...resume(), position: -1 }, { ...resume(), position: Infinity },
      { ...resume(), position: '12' }, { ...resume(), autoNext: 'true' }, { ...resume(), finished: 1 }]) {
      expect(normalizeClassResume(invalid)).toBeNull();
    }
    expect(normalizeClassResume({ ...resume(), finished: undefined })).toEqual(resume());
    expect(loadClassResume({ getItem: () => '{broken' })).toMatchObject({ resume: null, error: expect.any(String) });
    expect(loadClassResume({ getItem: () => '{"classId":"gone"}' })).toMatchObject({ resume: null, error: expect.any(String) });
  });

  it('reports denied reads, quota failures and denied clears without claiming success', () => {
    const denied = () => { throw new DOMException('Blocked', 'SecurityError'); };
    expect(loadClassResume({ getItem: denied })).toMatchObject({ resume: null, error: expect.any(String) });
    expect(saveClassResume(resume(), { setItem: denied })).toMatchObject({ saved: false, error: expect.any(String) });
    expect(clearClassResume({ removeItem: denied })).toMatchObject({ cleared: false, error: expect.any(String) });
    vi.stubGlobal('localStorage', undefined);
    expect(saveClassResume(resume()).saved).toBe(false);
    const setItem = vi.fn();
    expect(saveClassResume({ ...resume(), position: NaN }, { setItem }).saved).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('ends only the session and leaves the saved class data untouched', () => {
    const removeItem = vi.fn();
    expect(clearClassResume({ removeItem })).toEqual({ cleared: true });
    expect(removeItem).toHaveBeenCalledExactlyOnceWith(CLASS_RESUME_STORAGE_KEY);
  });

  it('advances by exercise identity, preserving repeated media and stopping at the final entry', () => {
    expect(findNextClassEntry(entries, 'warmup')).toBe(entries[1]);
    expect(findNextClassEntry(entries, 'turn')).toBe(entries[2]);
    expect(findNextClassEntry(entries, 'again')).toBeNull();
    expect(findNextClassEntry(entries, 'missing')).toBeNull();
    expect(findNextClassEntry([], 'warmup')).toBeNull();
    expect(entries.map((entry) => entry.id)).toEqual(['warmup', 'turn', 'again']);
  });

  it('prefers the exercise name with a readable media fallback', () => {
    expect(getClassEntryLabel({ ...entries[0]!, name: '  Basic step  ' }, media('song'))).toBe('Basic step');
    expect(getClassEntryLabel({ ...entries[0]!, name: ' ' }, media('song'))).toBe('song.wav');
    expect(getClassEntryLabel(entries[0]!)).toBe('Unavailable media');
  });
});

describe('class file preflight', () => {
  it('checks actual files sequentially and only once per media ID, even for repeated exercises', async () => {
    let inFlight = 0;
    let peak = 0;
    const loadFile = vi.fn(async (id: string) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return new File(['audio'], `${id}.wav`);
    });
    // Backup metadata may say unavailable; the actual reconnected files establish readiness.
    const result = await preflightClassFiles({ entries }, [media('song', false), media('video', false)], { loadFile });
    expect(result).toEqual({ ready: true, missing: [], checkedMediaCount: 2 });
    expect(loadFile.mock.calls.map(([id]) => id)).toEqual(['song', 'video']);
    expect(peak).toBe(1);
  });

  it('reports missing real files despite available metadata, including every affected occurrence', async () => {
    const loadFile = vi.fn(async (id: string) => {
      if (id === 'song') throw new Error('This file is not saved on this device.');
      return new File(['video'], 'video.mp4');
    });
    const result = await preflightClassFiles({ entries }, [media('song'), media('video')], { loadFile });
    expect(result).toEqual({ ready: false, checkedMediaCount: 2, missing: [{ mediaId: 'song',
      entryIds: ['warmup', 'again'], label: 'song.wav', reason: 'This file is not saved on this device.' }] });
  });

  it('rejects empty or unreadable blobs and does not claim an empty class is ready', async () => {
    const empty = await preflightClassFiles({ entries: [entries[0]!] }, [media('song')], {
      loadFile: async () => new File([], 'empty.wav'),
    });
    expect(empty.ready).toBe(false);
    expect(empty.missing[0]?.reason).toContain('empty');
    const unreadable = new File(['audio'], 'song.wav');
    vi.spyOn(unreadable, 'slice').mockImplementation(() => { throw new Error('Saved file cannot be read'); });
    const result = await preflightClassFiles({ entries: [entries[0]!] }, [media('song')], { loadFile: async () => unreadable });
    expect(result.missing[0]?.reason).toContain('cannot be read');
    const loadFile = vi.fn();
    expect(await preflightClassFiles({ entries: [] }, [], { loadFile })).toEqual({ ready: false, missing: [], checkedMediaCount: 0 });
    expect(loadFile).not.toHaveBeenCalled();
  });

  it('aborts a pending check without reporting success or checking the next file', async () => {
    const controller = new AbortController();
    let resolveFile: ((file: File) => void) | undefined;
    const pending = new Promise<File>((resolve) => { resolveFile = resolve; });
    const loadFile = vi.fn(() => pending);
    const check = preflightClassFiles({ entries }, [media('song'), media('video')], { loadFile, signal: controller.signal });
    controller.abort();
    resolveFile!(new File(['audio'], 'song.wav'));
    await expect(check).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadFile).toHaveBeenCalledTimes(1);
    await expect(preflightClassFiles({ entries }, [], { loadFile, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(loadFile).toHaveBeenCalledTimes(1);
  });
});
