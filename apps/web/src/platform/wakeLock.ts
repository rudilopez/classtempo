/**
 * Optional "Keep screen on" via the Screen Wake Lock API (Chrome / Android, Safari 16.4+; older iOS versions may
 * not honour it in Home Screen apps). The browser drops the lock whenever the page is hidden, so while enabled it
 * is taken again each time the page becomes visible. `onChange` reports whether the lock is really held, so a
 * toggle can follow refusals and system releases (battery saver / Low Power Mode). Feature-detected; never throws.
 */

export interface WakeLockOptions {
  /**
   * The lock state while enabled: called after each request with whether it was granted, and with false when the
   * browser drops the lock while the page is visible. Not called for a drop while hidden (it is requested again on
   * return) or for `disable()`.
   */
  onChange?(active: boolean): void;
}

export interface ScreenWakeLock {
  /** The API exists here (a request can still be refused, e.g. in Low Power Mode). */
  readonly supported: boolean;
  /** Turns "keep screen on" on and requests the lock. Resolves to whether the lock is now held. */
  enable(): Promise<boolean>;
  /** Turns it off and releases the lock. */
  disable(): Promise<void>;
  /** The lock is currently held (false while hidden, even when enabled). */
  readonly active: boolean;
}

export function createWakeLock(opts: WakeLockOptions = {}): ScreenWakeLock {
  const api = typeof navigator !== 'undefined' && typeof document !== 'undefined' && 'wakeLock' in navigator
    ? navigator.wakeLock
    : null;
  let enabled = false;
  let sentinel: WakeLockSentinel | null = null;
  let pending: Promise<boolean> | null = null;

  const notify = (active: boolean) => {
    try {
      opts.onChange?.(active);
    } catch (err) {
      console.warn('[mixdeck] wake lock onChange failed', err);
    }
  };

  const request = async (wl: WakeLock): Promise<boolean> => {
    let s: WakeLockSentinel;
    try {
      s = await wl.request('screen');
    } catch {
      // NotAllowedError: page hidden, Low Power Mode / battery saver, or blocked by policy.
      if (enabled) notify(false);
      return false;
    }
    if (!enabled) {
      // Disabled while the request was in flight.
      await s.release().catch(() => {});
      return false;
    }
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel !== s) return;
      sentinel = null;
      // Dropped while in view (battery saver, Low Power Mode, policy). A drop because the page was hidden is not
      // reported: the lock is requested again when it becomes visible.
      if (enabled && document.visibilityState === 'visible') notify(false);
    });
    notify(true);
    return true;
  };

  const acquire = (): Promise<boolean> => {
    if (!api) return Promise.resolve(false);
    if (sentinel && !sentinel.released) return Promise.resolve(true);
    if (pending) return pending;
    const p = request(api);
    pending = p;
    void p.finally(() => {
      if (pending === p) pending = null;
    });
    return p;
  };

  const onVisibilityChange = () => {
    if (enabled && document.visibilityState === 'visible') void acquire();
  };

  return {
    supported: api !== null,
    get active() {
      return sentinel !== null && !sentinel.released;
    },
    async enable() {
      if (!api) return false;
      if (!enabled) {
        enabled = true;
        document.addEventListener('visibilitychange', onVisibilityChange);
      }
      return acquire();
    },
    async disable() {
      if (enabled) {
        enabled = false;
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      const s = sentinel;
      sentinel = null;
      if (s && !s.released) await s.release().catch(() => {});
    },
  };
}
