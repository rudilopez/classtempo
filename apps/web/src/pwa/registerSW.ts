/**
 * Registers the offline service worker (production builds only; dev unregisters one left over from a preview)
 * and asks for persistent storage. Updates never reload the page: a new
 * version installs in the background, takes over the cache, and is used from the next launch on, so a set
 * in progress is never interrupted. UI can subscribe with `onUpdateReady` to show a quiet "updated" hint.
 * Installed apps are resumed from the app switcher rather than relaunched, so the app also checks for a new
 * version itself when it comes back to the foreground (at most once an hour).
 */

import { requestPersistentStorage } from '../platform/persist';

type Listener = () => void;

/** Minimum time between the foreground update checks. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

const listeners = new Set<Listener>();
let updateReady = false;

/** Calls `cb` once a newer version has been installed (immediately if that already happened). Returns an unsubscribe. */
export function onUpdateReady(cb: Listener): () => void {
  listeners.add(cb);
  if (updateReady) cb();
  return () => {
    listeners.delete(cb);
  };
}

export function registerSW(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  if (!import.meta.env.PROD) {
    // `npm run preview` and `npm run dev` share localhost:5173: drop a production SW left by a preview, or its
    // cache-first handler keeps serving stale /src modules to the dev page.
    void sw
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
      .catch(() => {});
    return;
  }
  // The first install also fires controllerchange (it claims this page); only later swaps are updates.
  let controlled = sw.controller !== null;
  sw.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (updateReady) return;
    updateReady = true;
    for (const cb of listeners) cb();
  });
  const register = () => {
    // Relative URL: the default scope is then the app's own directory, at / or under a sub-path.
    sw.register('./sw.js')
      .then((reg) => {
        // Home Screen apps (iOS/iPadOS and Android) are resumed, not relaunched, so no navigation triggers the
        // browser's own update check. Registering just checked, so start the throttle now. Safe mid-set: the new
        // worker never reloads this page, and activate keeps the previous cache for chunks it may still load.
        let checked = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState !== 'visible' || Date.now() - checked < UPDATE_CHECK_MS) return;
          checked = Date.now();
          // Rejects when offline; the next foreground after the throttle tries again.
          void reg.update().catch(() => {});
        });
      })
      .catch((err: unknown) => console.warn('[mixdeck] service worker registration failed', err));
    // Ask the browser not to evict the offline cache and saved cues under storage pressure; shares the one
    // memoised request with the first cue set, so Firefox (which asks the user) asks at most once per load.
    void requestPersistentStorage();
  };
  // Register after load so precaching doesn't compete with the first paint.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
