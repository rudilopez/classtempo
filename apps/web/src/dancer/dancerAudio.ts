import type { DancerPlayer } from '@mixdeck/engine';
import type { KeepAlive } from '../platform/keepAlive';

/**
 * Dancer mode's live audio, read by App's audio recovery: set while Dancer mode is mounted (there is only ever
 * one), null otherwise. `deck.playing` says whether it means to be making sound; `keepAlive` is restarted along
 * with the AudioContext after an interruption.
 */
export const dancerAudio: { deck: DancerPlayer | null; keepAlive: KeepAlive | null } = { deck: null, keepAlive: null };

/** Whether Dancer mode is playing (or means to be, while the context is interrupted). */
export function isDancerPlaying(): boolean {
  return dancerAudio.deck?.playing ?? false;
}

/** Restarts the Dancer keep-alive if Dancer mode is playing; call inside a tap where possible. */
export function restartDancerKeepAlive(): void {
  if (isDancerPlaying()) void dancerAudio.keepAlive?.start();
}
