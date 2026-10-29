import type { LibraryDestination } from './navigation';

const COPY: Record<LibraryDestination, { title: string; detail: string }> = {
  files: {
    title: 'Use these in class plans',
    detail: 'Create teaching playlists from your saved songs, videos and practices.',
  },
  classes: {
    title: 'Create and edit here',
    detail: 'Your teaching playlists, made from saved files. Streaming media stays in its own service.',
  },
  'apple-music': {
    title: 'Browse here · Create in the Apple Music app',
    detail: 'Choose one song at a time. Streaming songs cannot be added to ClassTempo class plans.',
  },
  spotify: {
    title: 'Browse here · Create in the Spotify app',
    detail: 'Choose one song at a time. Streaming songs cannot be added to ClassTempo class plans.',
  },
  youtube: {
    title: 'Single videos here',
    detail: 'YouTube playlists are not supported in ClassTempo. Videos cannot be added to class plans.',
  },
};

/** Explain playlist capabilities at the point where a source is browsed. */
export function LibraryCapability({ destination }: { destination: LibraryDestination }) {
  const copy = COPY[destination];
  return <div className="library-capability"><span aria-hidden="true">≡</span><div>
    <strong>{copy.title}</strong><p>{copy.detail}</p>
  </div></div>;
}
