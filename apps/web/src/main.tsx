import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { LocalPlayerRequest } from './dancer/DancerMode';
import { registerSW } from './pwa/registerSW';
import './styles.css';

// A hash route works on the static Pages host. The model/runtime is loaded only after opening the lab.
const StemsBenchmark = lazy(() => import('./stems/StemsBenchmark'));
const AppleMusic = lazy(() => import('./appleMusic/AppleMusic'));
const route = (): 'stems' | 'apple-music' | 'player' => window.location.hash === '#stems-benchmark' ? 'stems'
  : window.location.hash === '#apple-music' ? 'apple-music' : 'player';
const initialRoute = route();
if (initialRoute === 'stems') window.addEventListener('hashchange', () => {
  if (route() !== 'stems') window.location.reload();
});
function PlayerSources(): React.ReactElement {
  const [source, setSource] = useState(initialRoute);
  const [localVisited, setLocalVisited] = useState(initialRoute === 'player');
  const [request, setRequest] = useState<LocalPlayerRequest>();
  useEffect(() => {
    const change = () => {
      const next = route();
      // The memory benchmark still needs a fresh document without either playback engine.
      if (next === 'stems' || initialRoute === 'stems') { window.location.reload(); return; }
      if (next === 'player') setLocalVisited(true);
      setSource(next);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const openLocal = (file?: File) => {
    setRequest((previous) => ({ id: (previous?.id ?? 0) + 1, file, library: !file }));
    setLocalVisited(true);
    window.history.pushState(null, '', import.meta.env.BASE_URL);
    setSource('player');
  };
  return <>
    {localVisited && <App active={source === 'player'} request={request} />}
    {source === 'apple-music' && <Suspense fallback={<p role="status">Opening Apple Music…</p>}>
      <AppleMusic onOpenFile={(file) => openLocal(file)} onOpenLocalLibrary={() => openLocal()} />
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
