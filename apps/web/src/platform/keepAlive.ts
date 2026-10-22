/**
 * Silent `<audio>` keep-alive. While it plays, the browser treats the page as a media player, and Media Session
 * metadata/handlers attach to it. On iOS / iPadOS the Web Audio graph then keeps running with the screen locked
 * and the lock-screen Now Playing controls appear. On Android, Chrome shows its media notification (and so
 * lock-screen and headphone controls) only for an `<audio>`/`<video>` element longer than 5 s, never for Web
 * Audio output, so this element is what makes those controls possible there. Start it in the same tap that
 * starts playback; a locked phone cannot start audio.
 *
 * The element is shaped like the loaded song (`setTrack`: a silent WAV as long as the song, not looping) and its
 * clock follows the song's (`sync`: same position and rate), so everything WebKit reads from the element agrees
 * with the Media Session position state.
 *
 * WHY THE iOS LOCK-SCREEN SCRUBBER COULD NOT BE DRAGGED. Evidence from WebKit main (github.com/WebKit/WebKit,
 * read 2026-10-22; "l." = line in that revision):
 *
 * 1. Dragging the scrubber is MediaRemote's SeekToPlaybackPosition command (MPChangePlaybackPositionCommand).
 *    platform/cocoa/RemoteCommandListenerCocoa.mm, updateSupportedCommands (l.102-132), drops every seek command
 *    while `!supportsSeeking()` (l.113-114), and its command handler refuses them too (l.181-185).
 * 2. That flag is set by RemoteCommandListener::setSupportsSeeking (platform/RemoteCommandListener.cpp l.90-97),
 *    which only schedules a deferred update, so the last writer wins. Writer A,
 *    MediaSessionManagerCocoa::scheduleSessionStatusUpdate (platform/audio/cocoa/MediaSessionManagerCocoa.mm
 *    l.264-275), writes `computeSupportsSeeking()` (l.268) after every playback admission (l.278) and every
 *    clientCharacteristicsChanged (l.359), i.e. every setPositionState, metadata or action-handler change
 *    (html/MediaElementSession.cpp l.1844-1862). computeSupportsSeeking (platform/audio/
 *    MediaSessionManagerInterface.cpp l.872-878) asks currentSession(), which is the session that most recently
 *    BEGAN playback (platform/audio/PlatformMediaSessionManager.cpp setCurrentSession l.90-96 /
 *    currentSession l.98-104, called from MediaSessionManagerInterface::startSessionAdmission l.520-524;
 *    admissions run one after another in call order, MediaSessionManagerInterface::sessionWillBeginPlayback
 *    l.478-509). Writer B, NowPlayingManager::setNowPlayingInfoPrivate (platform/NowPlayingManager.cpp
 *    l.122-124), writes the now-playing element's own value (true), but only when an update is actually sent:
 *    MediaSessionManagerCocoa::updateNowPlayingInfo skips unchanged info (l.717-720; shouldUpdateNowPlaying
 *    l.530-612: while playing, only a jump of more than ~5 s counts).
 * 3. ROOT CAUSE: two sessions that cannot seek took "current" from this element.
 *    a. The page's Media Session itself. Since WebKit 305995@main (Jan 2026, iOS 26.4+),
 *       MediaSession::setPlaybackState (Modules/mediasession/MediaSession.cpp l.275-296) starts a playback
 *       session of its own when playbackState becomes 'playing' (l.289-290), and that session's supportsSeeking()
 *       is false (MediaSession.h l.200). Dancer mode set playbackState = 'playing' right AFTER starting this
 *       element, so the Media Session was admitted last; every later setPositionState (each seek, every 5 s)
 *       rewrote "no seeking" (writer A) and the matching info update was skipped as unchanged (writer B).
 *    b. The AudioContext: supportsSeeking() is false (Modules/webaudio/AudioContext.h l.145), and resume() is
 *       admitted asynchronously (AudioContext.cpp resumeRendering l.300-378 -> willBeginPlayback, l.530), so
 *       after an <audio>.play() issued in the same tap.
 *    A playing element is never admitted again (platform/audio/PlatformMediaSession.cpp clientWillBeginPlayback
 *    l.286; html/HTMLMediaElement.cpp playInternal l.4768), so the only way to make it current again is
 *    pause() + play(): `claim()`.
 * 4. The `loop` attribute: a second, confirmed bug. When the looping element wraps, AVFoundation reports the end
 *    (platform/graphics/avfoundation/MediaPlayerPrivateAVFoundation.cpp didEnd l.727-743), and
 *    HTMLMediaElement::handlePlaybackPositionChanged calls clientCharacteristicsChanged(true) (l.6322) and
 *    seekInternal(0) (l.6332), whose finishSeek calls it again (l.4256). MediaElementSession::
 *    clientCharacteristicsChanged (l.1863-1878) then REPLACES the page's position state with the element's own
 *    currentTime (l.1871): the lock-screen playhead jumped back to 0:00-0:10 every 10 s. Any seek of the element
 *    does the same, hence a song-length file whose clock follows the song.
 * 5. Ruled out. Live stream / infinite duration: MediaSessionManagerCocoa::setNowPlayingInfo (l.423-500) sends
 *    no live-stream flag and the duration comes from the position state (MediaSession::updateNowPlayingInfo
 *    l.599-606); the infinite mediaSessionDuration of a looping element (HTMLMediaElement.cpp l.10485) is not used
 *    for Now Playing. Handlers registered before the element played: supported commands are per page
 *    (MediaSession::setActionHandler l.298-360) and recomputed when the current session changes; they are lost
 *    only if registered while the page has no media session at all (NowPlayingManager::addSupportedCommand
 *    l.145, listener made by addClient l.47) - mediaSession.ts `refreshHandlers()` covers that.
 * 6. Remaining WebKit limitation: while PAUSED with the AudioContext still running, sessionWillEndPlayback
 *    (MediaSessionManagerInterface.cpp l.640) puts the paused element behind every playing session, so the
 *    running AudioContext is current again and the scrubber cannot be dragged while paused. Lock-screen commands
 *    go to the first eligible session in that order (processDidReceiveRemoteControlCommand l.771), and an
 *    AudioContext with navigator.audioSession 'playback' is eligible (AudioContext.cpp l.576, l.638).
 */

/** Length of the default loop (no song yet) and the shortest file, seconds: over the 5 s Chrome needs. */
const LOOP_SECONDS = 10;
/** Sample rate of the generated file, Hz (8 kHz 16-bit mono = 16 KB per second). */
const SAMPLE_RATE = 8000;
const WAV_HEADER_BYTES = 44;
/** Silence after the song's end, seconds, so the element never ends (and pauses its session) before the song. */
const TRACK_PADDING_SECONDS = 1;
/** Longest generated file, seconds (20 min = 19.2 MB); longer songs loop it and their position is not followed. */
const MAX_TRACK_SECONDS = 20 * 60;
/** The element is re-seeked only when its clock is further than this from the song's, seconds. */
const SYNC_TOLERANCE_SECONDS = 0.25;
const MIN_RATE = 0.25;
const MAX_RATE = 4;

/** What `createKeepAlive` needs of an AudioContext. */
export interface AudioContextLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

export interface KeepAliveOptions {
  /**
   * The app's AudioContext. On WebKit, when it reaches 'running' while the keep-alive plays (its resume landed
   * after the keep-alive started), the keep-alive `claim()`s automatically so lock-screen scrubbing stays on.
   */
  context?: AudioContextLike | null;
  /** Called whenever the element starts playing, including native media controls, e.g. refreshHandlers. */
  onStarted?: () => void;
}

export interface KeepAlive {
  /**
   * Starts the silent element. Call it synchronously inside a user gesture: `play()` is issued before the first
   * await. Resolves once playback started or was refused; never rejects (a refusal, NotAllowedError outside a
   * gesture or AbortError from a racing `stop()`, just leaves it stopped). No-op while it already plays.
   */
  start(): Promise<void>;
  /** Pauses the element; lock-screen controls then show the paused state. */
  stop(): void;
  /** Stops and removes the element and frees its Blob URL. A later `setTrack()` / `start()` builds a fresh one. */
  dispose(): void;
  /**
   * Shapes the element like the loaded song: a silent, non-looping WAV `ceil(duration) + 1` s long (at least
   * 10 s; songs over 20 min loop a 20-min file). `null` (or an invalid duration) restores the 10 s loop and frees
   * the long file. Builds the file now, outside the tap that will play it. Call on every song load and with
   * `null` on unload; it pauses the element and resets its position to 0.
   */
  setTrack(duration: number | null): void;
  /**
   * Makes the element's clock follow the song: playback rate = `rate` (tempo, clamped to 0.25-4) and, when its
   * position is more than 0.25 s off, a seek to `position` (song seconds). Cheap when already aligned. Call it
   * wherever the lock-screen position is updated (play, pause, seek, cue launch, tempo change, load, end).
   */
  sync(position: number, rate: number): void;
  /**
   * Makes the playing element the page's most recently started media session again (pause() + play() in one
   * task; silent, so nothing is heard), which on WebKit re-enables lock-screen scrubbing after something else
   * started playback later. No-op when it is not playing, where navigator.audioSession is missing (not WebKit),
   * or while the page is hidden (a hidden page may refuse the play()).
   */
  claim(): void;
}

/** Length (seconds) and looping of the silent file for a song `duration` in seconds; null = no song. */
export function silentTrackPlan(duration: number | null): { seconds: number; loop: boolean } {
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return { seconds: LOOP_SECONDS, loop: true };
  const seconds = Math.max(LOOP_SECONDS, Math.ceil(duration) + TRACK_PADDING_SECONDS);
  return seconds > MAX_TRACK_SECONDS ? { seconds: MAX_TRACK_SECONDS, loop: true } : { seconds, loop: false };
}

/**
 * Bytes of a silent 16-bit PCM mono WAV file: a 44-byte header plus `round(seconds × sampleRate)` zero samples.
 * Non-finite or negative durations give an empty data chunk; the rate is rounded and clamped to 1–384000 Hz.
 */
export function makeSilentWav(seconds: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  const rate = Number.isFinite(sampleRate) ? Math.min(384000, Math.max(1, Math.round(sampleRate))) : SAMPLE_RATE;
  const frames = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * rate) : 0;
  const dataBytes = frames * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** WebKit is the engine whose lock-screen seeking depends on which session started last; it ships audioSession. */
function isWebKitAudioSession(): boolean {
  return typeof navigator !== 'undefined' && 'audioSession' in navigator;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Rate changes on silence need no pitch correction: varispeed is the cheapest algorithm. */
function useVarispeed(el: HTMLMediaElement): void {
  const media = el as HTMLMediaElement & { webkitPreservesPitch?: boolean; mozPreservesPitch?: boolean };
  try {
    if ('preservesPitch' in media) media.preservesPitch = false;
    if ('webkitPreservesPitch' in media) media.webkitPreservesPitch = false;
    if ('mozPreservesPitch' in media) media.mozPreservesPitch = false;
  } catch {
    // Read-only here.
  }
}

/** A keep-alive for the page. Builds nothing until the first `setTrack()` or `start()`; a no-op without a DOM. */
export function createKeepAlive(options: KeepAliveOptions = {}): KeepAlive {
  const context = options.context ?? null;
  const onStarted = options.onStarted;
  let audio: HTMLAudioElement | null = null;
  let url: string | null = null;
  /** The file the element should have, and the one it has. */
  let plan = silentTrackPlan(null);
  let loaded: { seconds: number; loop: boolean } | null = null;
  /** Song clock to follow. */
  let position = 0;
  let rate = 1;
  let watching = false;

  const onPlaying = () => {
    if (!audio || audio.paused) return;
    try {
      onStarted?.();
    } catch (err) {
      console.warn('[mixdeck] keep-alive onStarted failed', err);
    }
  };

  const applyRate = (el: HTMLAudioElement) => {
    try {
      if (el.defaultPlaybackRate !== rate) el.defaultPlaybackRate = rate;
      if (el.playbackRate !== rate) el.playbackRate = rate;
    } catch {
      // Unsupported rate.
    }
  };

  const applyPosition = (el: HTMLAudioElement) => {
    // a looping file's clock cannot follow a song longer than the file: leave it alone rather than mislead
    if (!loaded || loaded.loop) return;
    const target = Math.min(position, loaded.seconds - TRACK_PADDING_SECONDS / 2);
    try {
      if (Math.abs(el.currentTime - target) > SYNC_TOLERANCE_SECONDS) el.currentTime = target;
    } catch {
      // Not seekable yet.
    }
  };

  /** Points the element at a fresh silent file matching `plan`, then frees the previous one. */
  const load = (el: HTMLAudioElement) => {
    const next = URL.createObjectURL(new Blob([makeSilentWav(plan.seconds, SAMPLE_RATE)], { type: 'audio/wav' }));
    el.loop = plan.loop;
    el.src = next;
    if (url) URL.revokeObjectURL(url);
    url = next;
    loaded = { ...plan };
  };

  const onContextState = () => {
    if (context?.state === 'running' && isWebKitAudioSession()) reclaim();
  };

  const watch = () => {
    if (watching || !context) return;
    try {
      context.addEventListener('statechange', onContextState);
      watching = true;
    } catch {
      // Not an event target.
    }
  };

  const unwatch = () => {
    if (!watching || !context) return;
    watching = false;
    try {
      context.removeEventListener('statechange', onContextState);
    } catch {
      // Already gone.
    }
  };

  const release = () => {
    unwatch();
    if (audio) {
      audio.removeEventListener('playing', onPlaying);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio.remove();
      audio = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
    loaded = null;
  };

  const element = (): HTMLAudioElement | null => {
    if (audio) return audio;
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
    try {
      const el = document.createElement('audio');
      el.preload = 'auto';
      // Not `muted`: muted media does not count as playing, so iOS would neither keep the page alive nor show
      // the lock-screen controls. The file is all zeros, so nothing is heard.
      el.setAttribute('playsinline', '');
      el.setAttribute('webkit-playsinline', '');
      el.setAttribute('aria-hidden', 'true');
      el.hidden = true;
      el.addEventListener('playing', onPlaying);
      useVarispeed(el);
      load(el);
      applyRate(el);
      applyPosition(el); // before metadata this sets where playback will start
      document.body?.appendChild(el);
      audio = el;
      watch();
    } catch (err) {
      console.warn('[mixdeck] keep-alive audio unavailable', err);
      release();
    }
    return audio;
  };

  /** Plays `el` (synchronously issuing play()); true once it really started. */
  const play = async (el: HTMLAudioElement): Promise<boolean> => {
    try {
      await el.play();
    } catch (err) {
      const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : '';
      if (name !== 'NotAllowedError' && name !== 'AbortError') console.warn('[mixdeck] keep-alive audio did not start', err);
      return false;
    }
    if (audio !== el || el.paused) return false;
    return true;
  };

  function reclaim(): void {
    const el = audio;
    if (!el || el.paused || pageHidden() || !isWebKitAudioSession()) return;
    try {
      el.pause();
    } catch {
      return;
    }
    void play(el);
  }

  return {
    async start() {
      const el = element();
      if (!el || !el.paused) return;
      applyRate(el);
      applyPosition(el);
      await play(el);
    },
    stop() {
      try {
        audio?.pause();
      } catch {
        // Already gone.
      }
    },
    dispose() {
      try {
        release();
      } catch {
        audio = null;
        url = null;
        loaded = null;
      }
    },
    setTrack(duration) {
      plan = silentTrackPlan(duration);
      position = 0;
      const el = element();
      if (!el) return;
      try {
        el.pause();
        if (!loaded || loaded.seconds !== plan.seconds || loaded.loop !== plan.loop) load(el);
      } catch (err) {
        console.warn('[mixdeck] keep-alive track unavailable', err);
      }
      applyRate(el);
      applyPosition(el);
    },
    sync(nextPosition, nextRate) {
      if (Number.isFinite(nextRate) && nextRate > 0) rate = Math.min(MAX_RATE, Math.max(MIN_RATE, nextRate));
      if (Number.isFinite(nextPosition)) position = Math.max(0, nextPosition);
      const el = audio;
      if (!el) return;
      applyRate(el);
      applyPosition(el);
    },
    claim: reclaim,
  };
}
