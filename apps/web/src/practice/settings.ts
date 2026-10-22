import type { StorageLike } from '../dancer/cueStore';

export interface PracticeSection {
  id: string;
  name: string;
  start: number;
  end: number;
}

export interface PracticeSettings {
  /** Playback rate; 1 is the original tempo. */
  tempo: number;
  sections: PracticeSection[];
  selectedSectionId: string | null;
  mode: 'off' | 'once' | 'repeat';
  /** Total passes, including the first. Null means repeat until stopped. */
  repetitions: number | null;
  gapSeconds: number;
  delaySeconds: number;
  videoMirrored: boolean;
  videoZoom: number;
}

export const MIN_SECTION_SECONDS = 0.25;
export const MAX_SECTIONS = 12;

export function defaultPracticeSettings(): PracticeSettings {
  return { tempo: 1, sections: [], selectedSectionId: null, mode: 'off', repetitions: null, gapSeconds: 0, delaySeconds: 0, videoMirrored: false, videoZoom: 1 };
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** Validates stored and imported data before it can schedule playback. */
export function normalizePracticeSettings(value: unknown, duration: number): PracticeSettings {
  const defaults = defaultPracticeSettings();
  if (!value || typeof value !== 'object') return defaults;
  const data = value as Record<string, unknown>;
  const endLimit = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const ids = new Set<string>();
  const sections: PracticeSection[] = [];
  if (Array.isArray(data.sections)) {
    for (const value of data.sections.slice(0, MAX_SECTIONS)) {
      if (!value || typeof value !== 'object') continue;
      const section = value as Record<string, unknown>;
      if (typeof section.id !== 'string' || !section.id || ids.has(section.id)) continue;
      if (typeof section.start !== 'number' || !Number.isFinite(section.start) || typeof section.end !== 'number' || !Number.isFinite(section.end)) continue;
      const start = Math.max(0, Math.min(endLimit, section.start));
      const end = Math.max(0, Math.min(endLimit, section.end));
      if (end - start < MIN_SECTION_SECONDS) continue;
      ids.add(section.id);
      sections.push({
        id: section.id,
        name: typeof section.name === 'string' && section.name.trim() ? section.name.trim().slice(0, 60) : `Section ${sections.length + 1}`,
        start,
        end,
      });
    }
  }
  const selectedSectionId = typeof data.selectedSectionId === 'string' && ids.has(data.selectedSectionId)
    ? data.selectedSectionId : sections[0]?.id ?? null;
  return {
    tempo: finite(data.tempo, 1, 0.5, 1.5),
    sections,
    selectedSectionId,
    mode: selectedSectionId && (data.mode === 'once' || data.mode === 'repeat') ? data.mode : 'off',
    repetitions: data.repetitions === null || data.repetitions === undefined ? null : Math.round(finite(data.repetitions, 2, 1, 100)),
    gapSeconds: finite(data.gapSeconds, 0, 0, 30),
    delaySeconds: finite(data.delaySeconds, 0, 0, 30),
    videoMirrored: data.videoMirrored === true,
    videoZoom: finite(data.videoZoom, 1, 1, 2),
  };
}

export function practiceKey(name: string, duration: number): string {
  return `mixdeck.practice.${name}|${duration.toFixed(2)}`;
}

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function loadPracticeSettings(name: string, duration: number, storage: StorageLike | null = defaultStorage()): PracticeSettings {
  try {
    const raw = storage?.getItem(practiceKey(name, duration));
    return raw ? normalizePracticeSettings(JSON.parse(raw) as unknown, duration) : defaultPracticeSettings();
  } catch { return defaultPracticeSettings(); }
}

export function savePracticeSettings(name: string, duration: number, settings: PracticeSettings, storage: StorageLike | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(practiceKey(name, duration), JSON.stringify(normalizePracticeSettings(settings, duration)));
    return true;
  } catch { return false; }
}

export function selectedPracticeSection(settings: PracticeSettings): PracticeSection | null {
  return settings.sections.find((section) => section.id === settings.selectedSectionId) ?? null;
}
