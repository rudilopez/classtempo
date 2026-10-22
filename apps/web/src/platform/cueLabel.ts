/**
 * Where the playhead is among a song's cues, as one short line for the lock-screen Now Playing card (the Media
 * Session `artist` line), e.g. "Chorus · next: Bridge". Pure functions over the cue pads: `null` (empty pad) and
 * non-finite times are ignored, and the array is in pad order, not time order.
 */

/** A set cue pad: its time in the song (seconds, tempo-independent) and its name. */
export interface NamedCue {
  time: number;
  name: string;
}

/** The cue whose section the playhead is in, and the cue after it. */
export interface CueSection {
  /** Latest cue at or before the playhead; null before the first cue. */
  current: NamedCue | null;
  /** Earliest cue after the playhead (what lock-screen "next" launches); null after the last cue. */
  next: NamedCue | null;
}

/**
 * Margin, seconds: a cue at most this far past the playhead already counts as the current section, so a cue that
 * was just launched (playhead at or a hair before it) is "current", never "next". Matches `NEXT_CUE_EPSILON` of
 * cueNavigation, so the line's "next" is exactly the cue the lock-screen next button launches.
 */
export const SECTION_EPSILON = 0.05;

/** Shown when the song has no cues. */
export const NO_CUES_LINE = 'No cues yet';

/**
 * The section the playhead is in. Of several pads at the same time, the first in pad order wins, so the result
 * does not depend on how the pads were set.
 */
export function cueSection(cues: readonly (NamedCue | null)[], position: number): CueSection {
  let current: NamedCue | null = null;
  let next: NamedCue | null = null;
  if (!Number.isFinite(position)) return { current, next };
  const edge = position + SECTION_EPSILON;
  for (const cue of cues) {
    if (!cue || !Number.isFinite(cue.time)) continue;
    if (cue.time <= edge) {
      if (!current || cue.time > current.time) current = cue;
    } else if (!next || cue.time < next.time) {
      next = cue;
    }
  }
  return { current, next };
}

function label(cue: NamedCue): string {
  return cue.name.trim() || 'Cue';
}

/**
 * The lock-screen line for a section: "Chorus · next: Bridge", "Cue 2 · last cue", "Before Cue 1 · next: Cue 1",
 * or "No cues yet" when `hasCues` is false (or no cue is valid).
 */
export function lockScreenLine(section: CueSection, hasCues: boolean): string {
  const { current, next } = section;
  if (!hasCues) return NO_CUES_LINE;
  if (current && next) return `${label(current)} · next: ${label(next)}`;
  if (current) return `${label(current)} · last cue`;
  if (next) return `Before ${label(next)} · next: ${label(next)}`;
  return NO_CUES_LINE;
}
