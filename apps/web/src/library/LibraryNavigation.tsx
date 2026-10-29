import { hasSpotifyTesterAccess } from '../spotify/access';
import type { LibraryDestination } from './navigation';

interface Props {
  destination: LibraryDestination;
  onChoose: (destination: LibraryDestination) => void;
  disabled?: boolean;
}

/** The two navigation groups stay in place while the Library's content changes. */
export function LibraryNavigation({ destination, onChoose, disabled = false }: Props) {
  const button = (id: LibraryDestination, label: string) => <button
    key={id} type="button" className="library-destination" disabled={disabled}
    aria-current={destination === id ? 'page' : undefined} onClick={() => onChoose(id)}>{label}</button>;
  return <nav className="library-navigation-menu" aria-label="Library destinations">
    <div className="library-navigation-group">
      <span className="library-navigation-label">On this device</span>
      <div className="library-navigation-row">
        {button('files', 'Saved files')}
        {button('classes', 'Class plans')}
      </div>
    </div>
    <div className="library-navigation-group">
      <span className="library-navigation-label">Streaming</span>
      <div className="library-navigation-row library-streaming-row">
        {import.meta.env.VITE_APPLE_MUSIC_ENABLED === 'true' && button('apple-music', 'Apple Music')}
        {button('youtube', 'YouTube')}
        {hasSpotifyTesterAccess() && button('spotify', 'Spotify')}
      </div>
    </div>
  </nav>;
}
