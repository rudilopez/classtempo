import type { LibraryDestination } from './navigation';

export type PlaybackSource = 'player' | 'apple-music' | 'spotify' | 'youtube';
export interface LibrarySession {
  source: PlaybackSource;
  destination: LibraryDestination;
  open: boolean;
}
export type LibrarySessionAction =
  | { type: 'open'; destination?: LibraryDestination }
  | { type: 'close' }
  | { type: 'select'; source: PlaybackSource; keepLibrary?: boolean };

/** Navigation changes the browser; only a deliberate media selection changes playback ownership. */
export function librarySessionReducer(state: LibrarySession, action: LibrarySessionAction): LibrarySession {
  if (action.type === 'open') return { ...state, destination: action.destination ?? state.destination, open: true };
  if (action.type === 'close') return { ...state, open: false };
  return { ...state, source: action.source, open: action.keepLibrary === true };
}

const DESTINATION_KEY = 'classtempo.library.destination.v1';
const DESTINATIONS: readonly LibraryDestination[] = ['files', 'classes', 'apple-music', 'youtube', 'spotify'];
export function readLibraryDestination(spotifyVisible: boolean): LibraryDestination {
  try {
    const value = sessionStorage.getItem(DESTINATION_KEY);
    if (DESTINATIONS.includes(value as LibraryDestination) && (value !== 'spotify' || spotifyVisible)) return value as LibraryDestination;
  } catch { /* The current session still remembers navigation when browser storage is blocked. */ }
  return 'files';
}
export function rememberLibraryDestination(destination: LibraryDestination): void {
  try { sessionStorage.setItem(DESTINATION_KEY, destination); } catch { /* Optional navigation memory only. */ }
}
