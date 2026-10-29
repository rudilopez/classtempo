export const SPOTIFY_TESTER_INVITE_HASH = '#spotify-invite';

/** Nonsecret UI invitation, so installed apps can opt in without sharing a browser's storage. */
export function isSpotifyTesterCode(value: string): boolean {
  return value.trim().toUpperCase() === 'FAMILIA';
}

const ACCESS_KEY = 'classtempo.spotify.tester.v1';
const ENABLED = '1';
const DISABLED = '0';
type Store = 'localStorage' | 'sessionStorage';
let documentAccess: boolean | null = null;

function storage(kind: Store): Storage {
  return kind === 'localStorage' ? localStorage : sessionStorage;
}

function read(kind: Store): string | null {
  try { return storage(kind).getItem(ACCESS_KEY); } catch { return null; }
}

/** UI discovery only. Spotify's account allowlist and OAuth still control playback access. */
export function hasSpotifyTesterAccess(): boolean {
  if (documentAccess !== null) return documentAccess;
  const markers = [read('localStorage'), read('sessionStorage')];
  // A surviving revocation marker wins over a stale grant in the other store.
  if (markers.includes(DISABLED)) return false;
  return markers.includes(ENABLED);
}

/** Consumes an explicit invite before remembering this browser; never authorizes an account. */
export function acceptSpotifyTesterInvite(): boolean {
  try {
    const url = new URL(location.href);
    if (url.hash !== SPOTIFY_TESTER_INVITE_HASH) return false;
    url.hash = 'spotify';
    // Consuming first prevents a failed Hide/reload from replaying the invite automatically.
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    return false;
  }
  documentAccess = true;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try { storage(kind).setItem(ACCESS_KEY, ENABLED); } catch { /* This document remains enabled. */ }
  }
  return true;
}

/** Hide only this device's tester entry; credentials and saved cues have their own teardown. */
export function revokeSpotifyTesterAccess(): void {
  documentAccess = false;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    // Keep a tombstone to override a stale grant if the other store cannot be changed.
    try { storage(kind).setItem(ACCESS_KEY, DISABLED); } catch {
      try { storage(kind).removeItem(ACCESS_KEY); } catch { /* Memory still overrides fully blocked stores. */ }
    }
  }
}

/** Share the app's canonical invite, never the current page's OAuth or tracking query. */
export function spotifyTesterInviteUrl(): string {
  const url = new URL(import.meta.env.BASE_URL, location.href);
  url.search = '';
  url.hash = SPOTIFY_TESTER_INVITE_HASH;
  return url.href;
}
