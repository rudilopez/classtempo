/**
 * File routing and cue counts. Video stays on the native player without a second audio decode.
 * Pure helpers (no DOM), tested in media.test.ts.
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

/** Number of set pads. */
export function countCues(cues: readonly unknown[]): number {
  return cues.reduce<number>((n, c) => (c === null || c === undefined ? n : n + 1), 0);
}
