import type { ClassSet } from './store';
import type { PracticeSettings } from '../practice/settings';

export type LibraryDestination = 'files' | 'classes' | 'apple-music' | 'youtube' | 'spotify';

export interface LibraryPlayerSummary {
  title: string;
  source: string;
  playing: boolean;
}

/** Browsing is independent of the source that currently owns playback. */
export interface ProviderLibraryBridge {
  host: HTMLElement | null;
  /** This provider's browser is the visible Library destination. */
  visible: boolean;
  /** The shared Library covers the player, regardless of the browsing destination. */
  open: boolean;
  onOpen: (destination?: LibraryDestination) => void;
  /** Runs after the source is active and the previous source has suspended playback. */
  onActivate: (select: () => void) => void;
  onSummary: (summary: LibraryPlayerSummary) => void;
}

/** Current local-player actions are captured when its Library button is used. */
export interface LocalLibraryContext {
  currentFile: File | null;
  currentTitle: string | null;
  currentPractice: PracticeSettings;
  currentDuration?: number;
  activeClassId?: string;
  onLoad: (file: File, libraryId: string | null, practiceOverride?: PracticeSettings) => Promise<void>;
  onTeachClass: (classSet: ClassSet, entryId?: string) => Promise<void>;
}
