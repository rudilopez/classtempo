import { describe, expect, it, vi } from 'vitest';
import { importSelection } from './importFlow';

const song = (): File => new File(['audio'], 'Lesson.wav', { type: 'audio/wav' });
const video = (): File => new File(['video'], 'Footwork.mp4', { type: 'video/mp4' });

describe('library import selection', () => {
  it('treats picker cancellation as a no-op', async () => {
    const save = vi.fn();
    const open = vi.fn();
    const onProgress = vi.fn();
    expect(await importSelection([], { save, open, onProgress })).toEqual({
      selectedCount: 0, savedCount: 0, failedFiles: [], firstKind: null, opened: false, openError: null,
    });
    expect(save).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('saves every selected file in order before opening only the first', async () => {
    const files = [video(), song()];
    const order: string[] = [];
    const save = vi.fn(async (file: File) => { order.push(`save:${file.name}`); return { id: `saved:${file.name}` }; });
    const open = vi.fn(async (file: File) => { order.push(`open:${file.name}`); });
    const onProgress = vi.fn();
    const result = await importSelection(files, { save, open, onProgress });
    expect(order).toEqual(['save:Footwork.mp4', 'save:Lesson.wav', 'open:Footwork.mp4']);
    expect(open).toHaveBeenCalledExactlyOnceWith(files[0], 'saved:Footwork.mp4');
    expect(onProgress.mock.calls).toEqual([[files[0], 1, 2], [files[1], 2, 2]]);
    expect(result).toEqual({ selectedCount: 2, savedCount: 2, failedFiles: [], firstKind: 'video', opened: true, openError: null });
  });

  it('still opens the first file directly when saving fails and does not substitute a later saved file', async () => {
    const files = [video(), song()];
    const save = vi.fn(async (file: File) => {
      if (file === files[0]) throw new DOMException('Storage full', 'QuotaExceededError');
      return { id: 'second-saved' };
    });
    const open = vi.fn(async () => {});
    const result = await importSelection(files, { save, open });
    expect(open).toHaveBeenCalledExactlyOnceWith(files[0], null);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ savedCount: 1, failedFiles: ['Footwork.mp4'], firstKind: 'video', opened: true, openError: null });
  });

  it('retains secondary save failures in the result after the first file opens successfully', async () => {
    const files = [song(), video()];
    const save = vi.fn(async (file: File) => {
      if (file === files[1]) throw new Error('File could not be cloned');
      return { id: 'first-saved' };
    });
    const open = vi.fn(async () => {});
    const result = await importSelection(files, { save, open });
    expect(open).toHaveBeenCalledExactlyOnceWith(files[0], 'first-saved');
    expect(result).toMatchObject({ savedCount: 1, failedFiles: ['Footwork.mp4'], opened: true });
  });

  it('separates an opening failure from successful saves and never opens the second selection instead', async () => {
    const files = [song(), video()];
    const save = vi.fn(async (file: File) => ({ id: file.name }));
    const open = vi.fn(async () => { throw new Error('Unsupported audio format'); });
    const result = await importSelection(files, { save, open });
    expect(result).toMatchObject({ savedCount: 2, failedFiles: [], opened: false, openError: 'Unsupported audio format' });
    expect(open).toHaveBeenCalledExactlyOnceWith(files[0], 'Lesson.wav');
  });

  it('routes by actual MIME type, with extension fallback when the picker omits MIME', async () => {
    const deps = { save: async () => ({ id: 'saved' }), open: async () => {} };
    const audioMp4 = new File(['audio'], 'Audio-in-container.mp4', { type: 'audio/mp4' });
    const videoWithoutMime = new File(['video'], 'Footwork.MOV');
    expect((await importSelection([audioMp4], deps)).firstKind).toBe('audio');
    expect((await importSelection([videoWithoutMime], deps)).firstKind).toBe('video');
  });

  it('reports an unexpected load rejection without losing the storage outcome', async () => {
    const result = await importSelection([song()], {
      save: async () => { throw new Error('Unavailable storage'); },
      open: async () => { throw null; },
    });
    expect(result).toMatchObject({ savedCount: 0, failedFiles: ['Lesson.wav'], opened: false, openError: 'The selected file could not be opened.' });
  });
});
