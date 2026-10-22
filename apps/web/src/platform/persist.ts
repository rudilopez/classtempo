/**
 * Asks the browser not to evict site storage (saved cues) under storage pressure or Safari's 7-day rule. Chromium
 * and Safari decide silently (installed Home Screen apps usually qualify); Firefox asks the user, so an origin
 * that is already persisted is not asked again. Feature-detected; never rejects.
 */

let request: Promise<boolean> | null = null;

/** Requests persistent storage once per page load (later calls share the first result). Resolves to whether it is granted. */
export function requestPersistentStorage(): Promise<boolean> {
  request ??= ask();
  return request;
}

async function ask(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (typeof storage?.persist !== 'function') return false;
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
