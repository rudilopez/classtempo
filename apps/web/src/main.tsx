import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerSW } from './pwa/registerSW';
import './styles.css';

// A hash route works on the static Pages host. The model/runtime is loaded only after opening the lab.
const StemsBenchmark = lazy(() => import('./stems/StemsBenchmark'));
const AppleMusic = lazy(() => import('./appleMusic/AppleMusic'));
const route = (): 'stems' | 'apple-music' | 'player' => window.location.hash === '#stems-benchmark' ? 'stems'
  : window.location.hash === '#apple-music' ? 'apple-music' : 'player';
const initialRoute = route();
// Entering/leaving the lab starts a fresh document, releasing playback worklets before memory measurements.
// Handle a same-page fragment navigation too (for example opening the link in an already-running app).
window.addEventListener('hashchange', () => {
  if (route() !== initialRoute) window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {initialRoute === 'stems' ? (
      <Suspense fallback={<p role="status">Opening stems benchmark…</p>}>
        <StemsBenchmark />
      </Suspense>
    ) : initialRoute === 'apple-music' ? (
      <Suspense fallback={<p role="status">Opening Apple Music…</p>}>
        <AppleMusic />
      </Suspense>
    ) : <App />}
  </StrictMode>,
);

registerSW();
