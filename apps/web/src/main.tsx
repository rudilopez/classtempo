import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerSW } from './pwa/registerSW';
import './styles.css';

// A hash route works on the static Pages host. The model/runtime is loaded only after opening the lab.
const StemsBenchmark = lazy(() => import('./stems/StemsBenchmark'));
const isStemsBenchmark = window.location.hash === '#stems-benchmark';
// Entering/leaving the lab starts a fresh document, releasing playback worklets before memory measurements.
// Handle a same-page fragment navigation too (for example opening the link in an already-running app).
window.addEventListener('hashchange', () => {
  if ((window.location.hash === '#stems-benchmark') !== isStemsBenchmark) window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isStemsBenchmark ? (
      <Suspense fallback={<p role="status">Opening stems benchmark…</p>}>
        <StemsBenchmark />
      </Suspense>
    ) : <App />}
  </StrictMode>,
);

registerSW();
