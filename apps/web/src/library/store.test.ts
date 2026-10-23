import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishStorageTransaction, mediaId, moveClassEntry, normalizeClass, parseBackup, saveMedia, type LibraryBackup } from './store';
import { defaultPracticeSettings } from '../practice/settings';

function backup(): LibraryBackup {
  return {
    format: 'classtempo-library', version: 1, exportedAt: '2026-10-22',
    media: [{ id: 'song-a', name: 'Lesson.wav', type: 'audio/wav', kind: 'audio', size: 4000, lastModified: 10, addedAt: 20, openedAt: 30, available: true }],
    classes: [{ id: 'class-a', name: 'Beginners', updatedAt: 100, entries: [{ id: 'first', mediaId: 'song-a' }, { id: 'again', mediaId: 'song-a' }] }],
    settings: {},
  };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('class library data', () => {
  it('keeps separate occurrences of one song while rejecting duplicate exercise IDs', () => {
    const item = normalizeClass({ id: 'class', name: '  Tuesday  ', updatedAt: NaN, entries: [
      { id: 'first', mediaId: 'song' }, { id: 'second', mediaId: 'song' }, { id: 'first', mediaId: 'different' }, null, { id: 'bad' },
    ] });
    expect(item).toEqual({ id: 'class', name: 'Tuesday', updatedAt: 0, autoNext: false, entries: [{ id: 'first', mediaId: 'song' }, { id: 'second', mediaId: 'song' }] });
    expect(normalizeClass({ id: 'empty', name: '  ', entries: [] })).toBeNull();
  });

  it('moves exactly the selected occurrence and does not mutate the original order', () => {
    const entries = [{ id: 'a', mediaId: 'same-song' }, { id: 'b', mediaId: 'other' }, { id: 'c', mediaId: 'same-song' }];
    expect(moveClassEntry(entries, 'c', -1).map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
    expect(entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(moveClassEntry(entries, 'a', -1)).toEqual(entries);
    expect(moveClassEntry(entries, 'c', 1)).toEqual(entries);
    expect(moveClassEntry(entries, 'missing', 1)).toEqual(entries);
  });

  it('preserves independent exercise speeds and sections for two occurrences through a backup', () => {
    const value = backup();
    const practice = { ...defaultPracticeSettings(), tempo: 0.7, sections: [{ id: 'turn', name: 'Turn', start: 1, end: 3 }], selectedSectionId: 'turn', mode: 'repeat' as const };
    value.classes[0]!.entries = [
      { id: 'slow', mediaId: 'song-a', practice, practiceDuration: 10 },
      { id: 'normal', mediaId: 'song-a', practice: { ...practice, tempo: 1 }, practiceDuration: 10 },
    ];
    const restored = parseBackup(JSON.stringify(value));
    expect(restored.classes[0]?.entries.map((entry) => entry.practice?.tempo)).toEqual([0.7, 1]);
    expect(restored.classes[0]?.entries[0]?.practice?.sections).toEqual(practice.sections);
    const moved = moveClassEntry(restored.classes[0]!.entries, 'normal', -1);
    expect(moved.map((entry) => entry.practice?.tempo)).toEqual([1, 0.7]);
  });

  it('preserves teaching names, reminders and explicit continuous playback through a backup', () => {
    const value = backup();
    value.classes[0]!.autoNext = true;
    value.classes[0]!.entries[0] = { id: 'first', mediaId: 'song-a', name: ' Footwork slowly ', note: ' Count the first eight. ' };
    const restored = parseBackup(JSON.stringify(value));
    expect(restored.classes[0]?.autoNext).toBe(true);
    expect(restored.classes[0]?.entries[0]).toEqual({ id: 'first', mediaId: 'song-a', name: 'Footwork slowly', note: 'Count the first eight.' });
    expect(restored.media[0]?.available).toBe(false);
    expect(moveClassEntry(restored.classes[0]!.entries, 'first', 1)[1]?.note).toBe('Count the first eight.');
  });

  it('requires a boolean opt-in to automatic advance and bounds optional teaching text', () => {
    const normalized = normalizeClass({ id: 'class', name: 'Safe', autoNext: 'true', entries: [
      { id: 'first', mediaId: 'song-a', name: 'x'.repeat(150), note: 'y'.repeat(700) },
      { id: 'second', mediaId: 'song-a', name: { unsafe: true }, note: '  ' },
    ] });
    expect(normalized?.autoNext).toBe(false);
    expect(normalized?.entries[0]?.name).toHaveLength(100);
    expect(normalized?.entries[0]?.note).toHaveLength(500);
    expect(normalized?.entries[1]).toEqual({ id: 'second', mediaId: 'song-a' });
  });

  it('normalizes imported exercise settings before they can schedule playback', () => {
    const normalized = normalizeClass({ id: 'class', name: 'Safe import', entries: [
      { id: 'clamped', mediaId: 'song-a', practiceDuration: 10, practice: { tempo: 20, sections: [{ id: 'a', start: -5, end: 400, name: 'Long' }], mode: 'repeat', gapSeconds: -1 } },
      { id: 'bad-duration', mediaId: 'song-a', practiceDuration: Infinity, practice: { tempo: 0.7 } },
    ] });
    expect(normalized?.entries[0]?.practice?.tempo).toBe(1.5);
    expect(normalized?.entries[0]?.practice?.sections[0]).toEqual({ id: 'a', start: 0, end: 10, name: 'Long' });
    expect(normalized?.entries[0]?.practice?.gapSeconds).toBe(0);
    expect(normalized?.entries[1]?.practice).toBeUndefined();
  });

  it('distinguishes revised files and safely encodes separators in filenames', () => {
    const file = { name: 'a|b.wav', type: 'audio/wav', size: 100, lastModified: 20 };
    expect(mediaId(file)).not.toEqual(mediaId({ ...file, lastModified: 21 }));
    expect(mediaId(file)).not.toEqual(mediaId({ ...file, name: 'a%7Cb.wav' }));
    expect(mediaId(file)).toContain('a%7Cb.wav');
  });

  it('never restores an offline-available claim from a settings-only backup', () => {
    const restored = parseBackup(JSON.stringify(backup()));
    expect(restored.media[0]?.available).toBe(false);
    expect(restored.classes[0]?.entries).toHaveLength(2);
  });

  it('restores only allowed cue and practice JSON records, ignoring unrelated or corrupt storage', () => {
    const value = backup();
    value.settings = {
      'mixdeck.dancer.cues.Lesson.wav|3.00': '[{"time":1,"name":"Turn"}]',
      'mixdeck.practice.Lesson.wav|3.00': '{"tempo":0.8}',
      'mixdeck.practice.broken': '{broken',
      'mixdeck.practice.scalar': '42',
      'unrelated-login': '"secret"',
      '__proto__': '{"unexpected":true}',
    };
    expect(Object.keys(parseBackup(JSON.stringify(value)).settings)).toEqual(['mixdeck.dancer.cues.Lesson.wav|3.00', 'mixdeck.practice.Lesson.wav|3.00']);
  });

  it('rejects future formats, invalid metadata, duplicate IDs, and missing song references', () => {
    expect(() => parseBackup('{}')).toThrow('supported');
    expect(() => parseBackup(JSON.stringify({ ...backup(), version: 2 }))).toThrow('supported');
    const invalid = backup();
    invalid.media[0]!.size = -1;
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow('invalid');
    const duplicates = backup();
    duplicates.media.push({ ...duplicates.media[0]! });
    expect(() => parseBackup(JSON.stringify(duplicates))).toThrow('duplicate');
    const missing = backup();
    missing.classes[0]!.entries[0]!.mediaId = 'missing';
    expect(() => parseBackup(JSON.stringify(missing))).toThrow('missing');
  });

  it('reports unavailable storage instead of resolving with a falsely saved file', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const file = new File(['wave-data'], 'Lesson.wav', { type: 'audio/wav' });
    await expect(saveMedia(file)).rejects.toThrow('cannot save');
  });

  it('rejects an empty or unrelated file before opening storage', async () => {
    await expect(saveMedia(new File([], 'empty.wav', { type: 'audio/wav' }))).rejects.toThrow('non-empty');
    await expect(saveMedia(new File(['{}'], 'settings.json', { type: 'application/json' }))).rejects.toThrow('audio or video');
  });
});

describe('storage failure deadlines', () => {
  function transaction(): IDBTransaction {
    return { error: null, abort: vi.fn(), oncomplete: null, onerror: null, onabort: null } as unknown as IDBTransaction;
  }

  it('aborts a request-error transaction explicitly and preserves the browser error', async () => {
    const tx = transaction();
    const done = finishStorageTransaction(tx);
    const error = new DOMException('Error preparing Blob/File data', 'UnknownError');
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: { error } });
    tx.onerror?.call(tx, event);
    await expect(done).rejects.toBe(error);
    expect(tx.abort).toHaveBeenCalledOnce();
  });

  it('bounds a stalled write and aborts it instead of leaving the UI busy forever', async () => {
    vi.useFakeTimers();
    const tx = transaction();
    const done = finishStorageTransaction(tx);
    const failed = expect(done).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(tx.abort).toHaveBeenCalledOnce();
  });

  it('clears the deadline after success and permits a longer large-file deadline', async () => {
    vi.useFakeTimers();
    const tx = transaction();
    const done = finishStorageTransaction(tx, 60_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tx.abort).not.toHaveBeenCalled();
    tx.oncomplete?.call(tx, new Event('complete'));
    await expect(done).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tx.abort).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled database open and closes a connection that arrives after timeout', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const db = { close: vi.fn() };
    const request = { onupgradeneeded: null, onerror: null, onblocked: null, onsuccess: null, result: db } as unknown as IDBOpenDBRequest;
    vi.stubGlobal('indexedDB', { open: () => request });
    const fresh = await import('./store');
    const saving = fresh.saveMedia(new File(['bytes'], 'late.wav', { type: 'audio/wav' }));
    const failed = expect(saving).rejects.toThrow('storage is not responding');
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    request.onsuccess?.call(request, new Event('success'));
    expect(db.close).toHaveBeenCalledOnce();
  });
});
