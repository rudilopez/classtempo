import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { LocalPlayerRequest } from './dancer/DancerMode';
import type { LibraryView } from './library/LibraryModal';
import { registerSW } from './pwa/registerSW';
import { hasSpotifyCallback } from './spotify/auth';
import { acceptSpotifyTesterInvite, hasSpotifyTesterAccess } from './spotify/access';
import './styles.css';

// A hash route works on the static Pages host. The model/runtime is loaded only after opening the lab.
const StemsBenchmark = lazy(() => import('./stems/StemsBenchmark'));
const AppleMusic = lazy(() => import('./appleMusic/AppleMusic'));
const Spotify = lazy(() => import('./spotify/Spotify'));
const YouTube = lazy(() => import('./youtube/YouTube'));
const route = (): 'stems' | 'apple-music' | 'spotify' | 'youtube' | 'player' => {
  acceptSpotifyTesterInvite();
  if (window.location.hash === '#stems-benchmark') return 'stems';
  if (window.location.hash === '#apple-music') return 'apple-music';
  if (window.location.hash === '#youtube') return 'youtube';
  return hasSpotifyTesterAccess() && (window.location.hash === '#spotify' || hasSpotifyCallback())
    ? 'spotify' : 'player';
};
const initialRoute = route();
if (initialRoute === 'stems') window.addEventListener('hashchange', () => {
  if (route() !== 'stems') window.location.reload();
});
function PlayerSources(): React.ReactElement {
  const [source, setSource] = useState(initialRoute);
  const [localVisited, setLocalVisited] = useState(initialRoute === 'player');
  const [spotifyVisited, setSpotifyVisited] = useState(initialRoute === 'spotify');
  const [youtubeVisited, setYouTubeVisited] = useState(initialRoute === 'youtube');
  const [request, setRequest] = useState<LocalPlayerRequest>();
  useEffect(() => {
    const change = () => {
      const next = route();
      // The memory benchmark still needs a fresh document without either playback engine.
      if (next === 'stems' || initialRoute === 'stems') { window.location.reload(); return; }
      if (next === 'player') setLocalVisited(true);
      if (next === 'spotify') setSpotifyVisited(true);
      if (next === 'youtube') setYouTubeVisited(true);
      setSource(next);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const openLocal = (file?: File, libraryView: LibraryView = 'home') => {
    setRequest((previous) => ({ id: (previous?.id ?? 0) + 1, file, library: !file, libraryView }));
    setLocalVisited(true);
    window.history.pushState(null, '', import.meta.env.BASE_URL);
    setSource('player');
  };
  return <>
    {localVisited && <App active={source === 'player'} request={request} />}
    {source === 'apple-music' && <Suspense fallback={<p role="status">Opening Apple Music…</p>}>
      <AppleMusic onOpenFile={(file) => openLocal(file)} onOpenLocalLibrary={(view) => openLocal(undefined, view)} />
    </Suspense>}
    {spotifyVisited && <Suspense fallback={source === 'spotify' ? <p role="status">Opening Spotify…</p> : null}>
      <Spotify active={source === 'spotify'} onOpenFile={(file) => openLocal(file)} onOpenLocalLibrary={(view) => openLocal(undefined, view)}
        onOpenAppleMusic={() => { window.location.hash = 'apple-music'; }} />
    </Suspense>}
    {youtubeVisited && <Suspense fallback={source === 'youtube' ? <p role="status">Opening YouTube…</p> : null}>
      <YouTube active={source === 'youtube'} onOpenFile={(file) => openLocal(file)} onOpenLocalLibrary={(view) => openLocal(undefined, view)} />
    </Suspense>}
  </>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {initialRoute === 'stems' ? (
      <Suspense fallback={<p role="status">Opening stems benchmark…</p>}>
        <StemsBenchmark />
      </Suspense>
    ) : <PlayerSources />}
  </StrictMode>,
);

registerSW();
