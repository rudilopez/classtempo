import { MAX_SECTIONS, MIN_SECTION_SECONDS, normalizePracticeSettings, type PracticeSection, type PracticeSettings } from './settings';

/** Visible panel fields travel together so Start and Save commit the same range. */
export interface PracticeDraft {
  settings: PracticeSettings;
  sectionId: string | null;
  name: string;
  start: string;
  end: string;
}

export type PracticeDraftResult = { settings: PracticeSettings } | { error: string; field: 'start' | 'end' | 'section' };

/** Preserve media/cue precision: rounding can move an endpoint beyond the track or shorten a valid range. */
export function practiceTimeInput(value: number): string {
  return String(Math.max(0, value));
}

/** Commit the edited range directly; creating a section is never a separate prerequisite. */
export function commitPracticeDraft(draft: PracticeDraft, duration: number, createId: () => string): PracticeDraftResult {
  if (draft.settings.mode === 'off') return { settings: normalizePracticeSettings(draft.settings, duration) };
  const start = Number(draft.start);
  const end = Number(draft.end);
  if (!draft.start.trim() || !Number.isFinite(start) || start < 0 || start >= duration) {
    return { error: 'Choose a start within this track.', field: 'start' };
  }
  if (!draft.end.trim() || !Number.isFinite(end) || end > duration || end - start < MIN_SECTION_SECONDS) {
    return { error: 'End must be after Start and within this track. Leave at least 0.25 seconds between them.', field: 'end' };
  }
  const existing = draft.settings.sections.some((section) => section.id === draft.sectionId);
  if (!existing && draft.settings.sections.length >= MAX_SECTIONS) {
    return { error: `This track already has ${MAX_SECTIONS} saved practices. Choose one to edit or delete one first.`, field: 'section' };
  }
  const section: PracticeSection = {
    id: existing && draft.sectionId ? draft.sectionId : createId(),
    name: draft.name.trim().slice(0, 60) || `Practice ${draft.settings.sections.length + 1}`,
    start,
    end,
    playback: {
      tempo: draft.settings.tempo,
      mode: draft.settings.mode,
      repetitions: draft.settings.repetitions,
      gapSeconds: draft.settings.gapSeconds,
      delaySeconds: draft.settings.delaySeconds,
      videoMirrored: draft.settings.videoMirrored,
      videoZoom: draft.settings.videoZoom,
    },
  };
  const sections = existing
    ? draft.settings.sections.map((saved) => saved.id === section.id ? section : saved)
    : [...draft.settings.sections, section];
  return { settings: normalizePracticeSettings({ ...draft.settings, sections, selectedSectionId: section.id }, duration) };
}
