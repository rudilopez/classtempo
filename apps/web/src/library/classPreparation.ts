import { activatePracticeSection, normalizePracticeSettings, type PracticeSettings } from '../practice/settings';
import type { ClassEntry, LibraryMedia } from './store';

const PREFIX = 'mixdeck.practice.';
type PracticeStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;

export interface SavedClassPractice {
  id: string;
  mediaId: string;
  mediaName: string;
  name: string;
  duration: number;
  settings: PracticeSettings;
}

function defaultStorage(): PracticeStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Lists existing named practices without opening/decoding songs or changing their saved defaults. */
export function savedClassPractices(media: readonly LibraryMedia[], storage: PracticeStorage | null = defaultStorage()): SavedClassPractice[] {
  if (!storage) return [];
  const choices: SavedClassPractice[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const divider = key.lastIndexOf('|');
      const name = key.slice(PREFIX.length, divider);
      const duration = Number(key.slice(divider + 1));
      if (divider < PREFIX.length || !Number.isFinite(duration) || duration <= 0 || duration > 86_400) continue;
      const items = media.filter((item) => item.available && item.name === name);
      if (!items.length) continue;
      try {
        const settings = normalizePracticeSettings(JSON.parse(storage.getItem(key) ?? 'null') as unknown, duration);
        for (const item of items) for (const section of settings.sections) choices.push({
          id: JSON.stringify([item.id, key, section.id]), mediaId: item.id, mediaName: item.name,
          name: section.name, duration, settings: activatePracticeSection(settings, section.id),
        });
      } catch { /* One corrupt record must not hide intact saved practices. */ }
    }
  } catch { /* Blocked storage still permits adding ordinary saved media. */ }
  return choices;
}

/** Every occurrence gets a fresh, normalized snapshot; editing a class never edits the source preset. */
export function practiceClassEntry(choice: SavedClassPractice, id: string): ClassEntry {
  return { id, mediaId: choice.mediaId, name: choice.name, practiceDuration: choice.duration,
    practice: normalizePracticeSettings(choice.settings, choice.duration) };
}
