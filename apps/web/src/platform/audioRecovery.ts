/**
 * Brings the AudioContext back after an interruption: a phone call, Siri, an alarm or another app taking audio
 * moves it to 'interrupted' (WebKit) or 'suspended'. On every context state change, and whenever the page becomes
 * visible again, a context that should be running is resumed; if it is still not running shortly after, the
 * browser wants a tap, so the UI is asked to show a full-screen "Tap to resume audio" button. That tap resumes
 * the context (and restarts the keep-alive) inside the gesture; once the context runs again, or the app no longer
 * means to play (paused from the lock screen meanwhile), `onNeedsGesture(false)` is called. Feature-detected; never
 * throws.
 */

/** How long an automatic resume may take before a tap is asked for, ms. */
const RESUME_GRACE_MS = 500;

export interface AudioRecoveryOptions {
  /** Whether the app means to be making sound now (e.g. engine started, not deliberately suspended). */
  shouldBeRunning(): boolean;
  /** true: an automatic resume failed, show the "Tap to resume audio" button; false: no longer needed. */
  onNeedsGesture(needed: boolean): void;
  /** Called with each automatic resume attempt, e.g. to restart the keep-alive element (optional). */
  onResumeAttempt?(): void;
}

/** Starts watching `ctx`. Returns an unsubscribe function. */
export function watchAudioContext(ctx: AudioContext, opts: AudioRecoveryOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** `onNeedsGesture(true)` was called and not yet answered with false. */
  let asked = false;

  const needsGesture = (needed: boolean) => {
    asked = needed;
    try {
      opts.onNeedsGesture(needed);
    } catch (err) {
      console.warn('[mixdeck] onNeedsGesture failed', err);
    }
  };

  const shouldRun = (): boolean => {
    try {
      return opts.shouldBeRunning();
    } catch {
      return false;
    }
  };

  const stalled = (): boolean => {
    const state = ctx.state;
    return state === 'suspended' || state === 'interrupted';
  };

  const check = () => {
    if (stopped) return;
    if (ctx.state === 'running') {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (asked) needsGesture(false);
      return;
    }
    if (!stalled()) return;
    if (!shouldRun()) {
      // Paused on purpose meanwhile (e.g. from the lock screen or headphones): withdraw the tap request. The next
      // play resumes the context itself.
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (asked) needsGesture(false);
      return;
    }
    // A resume attempt is already waiting for its result.
    if (timer !== null) return;
    try {
      opts.onResumeAttempt?.();
    } catch {
      // The caller's extra resume work must not block the context resume.
    }
    try {
      void ctx.resume().catch(() => {});
    } catch {
      // Closed or otherwise unable to resume: the timer below asks for a tap.
    }
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      if (ctx.state === 'running') {
        if (asked) needsGesture(false);
      } else if (stalled() && shouldRun()) {
        needsGesture(true);
      }
    }, RESUME_GRACE_MS);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };

  ctx.addEventListener('statechange', check);
  const hasDocument = typeof document !== 'undefined';
  if (hasDocument) document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    ctx.removeEventListener('statechange', check);
    if (hasDocument) document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
