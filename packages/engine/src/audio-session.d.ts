/**
 * Ambient types for the W3C Audio Session API (https://w3c.github.io/audio-session/), which TypeScript's DOM lib
 * does not ship yet. Safari 16.4+ (iOS / iPadOS / macOS) implements it; other browsers have no
 * `navigator.audioSession`, hence the optional property.
 */

/** How the page's audio mixes with other audio and reacts to the Ring/Silent switch. */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';

type AudioSessionState = 'inactive' | 'active' | 'interrupted';

/** Fires 'statechange' when `state` changes. */
interface AudioSession extends EventTarget {
  type: AudioSessionType;
  readonly state: AudioSessionState;
}

interface Navigator {
  /** Absent outside WebKit: feature-detect before use. */
  readonly audioSession?: AudioSession;
}
