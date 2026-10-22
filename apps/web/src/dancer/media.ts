/**
 * What kind of player a picked or dropped file gets, and whether a video's sound is worth decoding for BPM and
 * peaks. Pure helpers (no DOM), tested in media.test.ts.
 */

/** File picker filter: audio and video, plus the extensions for browsers that report no MIME type (iOS Files). */
export const ACCEPT_MEDIA = 'audio/*,video/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.flac,.ogg,.mp4,.mov,.m4v,.webm';

const VIDEO_EXTENSION = /\.(mp4|mov|m4v|webm)$/i;

/**
 * Videos are played by a `<video>` element straight from the file (VideoDeck); everything else is decoded into
 * memory for the key-locked StretchDeck. The MIME type decides when the browser gives one (`audio/mp4` stays
 * audio); otherwise the extension does.
 */
export function isVideoFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  if (type.startsWith('audio/')) return false;
  if (type.startsWith('video/')) return true;
  return VIDEO_EXTENSION.test(file.name);
}

/** Largest video whose sound is decoded in the background for BPM and peaks, bytes. */
export const ANALYZE_MAX_BYTES = 150 * 1024 * 1024;
/**
 * Longest video decoded for analysis, seconds. Decoded sound costs ~23 MB per minute (48 kHz stereo float), so a
 * small file can still be too long for a phone's memory (a long, low-bitrate screen recording).
 */
export const ANALYZE_MAX_SECONDS = 10 * 60;

/** Whether a video's sound may be decoded for BPM and peaks: only small, short files; never blocks playback. */
export function canAnalyzeVideo(bytes: number, duration: number): boolean {
  return (
    Number.isFinite(bytes) &&
    bytes > 0 &&
    bytes <= ANALYZE_MAX_BYTES &&
    Number.isFinite(duration) &&
    duration > 0 &&
    duration <= ANALYZE_MAX_SECONDS
  );
}

/** Number of set pads. */
export function countCues(cues: readonly unknown[]): number {
  return cues.reduce<number>((n, c) => (c === null || c === undefined ? n : n + 1), 0);
}
