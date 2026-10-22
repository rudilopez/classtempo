/**
 * Previous / next cue relative to the playhead, for the lock-screen and headphone previous/next track controls.
 * Pure functions over cue times in seconds: `null` (empty pad) and non-finite entries are ignored, and the
 * array is in pad order, not time order.
 */

/** Default "restart this cue" window of `previousCueTime`, seconds. */
export const PREVIOUS_CUE_THRESHOLD = 2;
/** Default margin of `nextCueTime`, seconds: a cue just launched (playhead at or barely past it) is not "next". */
export const NEXT_CUE_EPSILON = 0.05;

function cueTimes(cues: readonly (number | null)[]): number[] {
  return cues.filter((t): t is number => t !== null && Number.isFinite(t));
}

/**
 * Music-player "previous": more than `threshold` s into the section that started at the latest cue at or before
 * `position` → back to that cue; within the first `threshold` s → the cue before it. 0 (start of the song)
 * when there is no such cue.
 */
export function previousCueTime(
  cues: readonly (number | null)[],
  position: number,
  threshold: number = PREVIOUS_CUE_THRESHOLD,
): number {
  const times = cueTimes(cues);
  let latest = -Infinity;
  for (const t of times) if (t <= position && t > latest) latest = t;
  if (latest === -Infinity) return 0;
  if (position - latest > threshold) return latest;
  let before = -Infinity;
  for (const t of times) if (t < latest && t > before) before = t;
  return before === -Infinity ? 0 : before;
}

/** Earliest cue strictly after `position + epsilon`, or null when there is none. */
export function nextCueTime(
  cues: readonly (number | null)[],
  position: number,
  epsilon: number = NEXT_CUE_EPSILON,
): number | null {
  let next: number | null = null;
  for (const t of cueTimes(cues)) if (t > position + epsilon && (next === null || t < next)) next = t;
  return next;
}
