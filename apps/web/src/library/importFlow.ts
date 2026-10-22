import { isVideoFile } from '../dancer/media';

export interface ImportSelectionDependencies {
  save: (file: File) => Promise<{ id: string }>;
  /** Null means saving was attempted and failed; open directly without retrying or claiming a saved copy. */
  open: (file: File, libraryId: string | null) => Promise<void>;
  /** One-based progress, called before each sequential save. */
  onProgress?: (file: File, index: number, total: number) => void;
}

export interface ImportSelectionResult {
  selectedCount: number;
  savedCount: number;
  failedFiles: string[];
  firstKind: 'audio' | 'video' | null;
  opened: boolean;
  openError: string | null;
}

/** Save the whole selection, then open its first file once. Playback state belongs to the paused load handler. */
export async function importSelection(
  files: readonly File[],
  dependencies: ImportSelectionDependencies,
): Promise<ImportSelectionResult> {
  const first = files[0];
  const result: ImportSelectionResult = {
    selectedCount: files.length,
    savedCount: 0,
    failedFiles: [],
    firstKind: first ? (isVideoFile(first) ? 'video' : 'audio') : null,
    opened: false,
    openError: null,
  };
  if (!first) return result;

  let firstId: string | null = null;
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!;
    dependencies.onProgress?.(file, index + 1, files.length);
    try {
      const saved = await dependencies.save(file);
      if (index === 0) firstId = saved.id;
      result.savedCount++;
    } catch {
      result.failedFiles.push(file.name);
    }
  }

  try {
    await dependencies.open(first, firstId);
    result.opened = true;
  } catch (error) {
    result.openError = error instanceof Error && error.message.trim()
      ? error.message : 'The selected file could not be opened.';
  }
  return result;
}
