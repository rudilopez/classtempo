import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { LocalPlayerRequest } from './dancer/DancerMode';
import { LibraryModal, type LibraryView } from './library/LibraryModal';
import type { LibraryDestination, LibraryPlayerSummary, LocalLibraryContext, ProviderLibraryBridge } from './library/navigation';
import { librarySessionReducer, readLibraryDestination, rememberLibraryDestination, type PlaybackSource } from './library/session';
import { registerSW } from './pwa/registerSW';
import { hasSpotifyCallback } from './spotify/auth';
import { acceptSpotifyTesterInvite, hasSpotifyTesterAccess } from './spotify/access';
import './styles.css';

const StemsBenchmark = lazy(() => import('./stems/StemsBenchmark'));
const AppleMusic = lazy(() => import('./appleMusic/AppleMusic'));
const Spotify = lazy(() => import('./spotify/Spotify'));
const YouTube = lazy(() => import('./youtube/YouTube'));
const route = (): PlaybackSource | 'stems' => {
  acceptSpotifyTesterInvite();
  if (window.location.hash === '#stems-benchmark') return 'stems';
  if (window.location.hash === '#apple-music') return 'apple-music';
  if (window.location.hash === '#youtube') return 'youtube';
  return hasSpotifyTesterAccess() && (window.location.hash === '#spotify' || hasSpotifyCallback()) ? 'spotify' : 'player';
};
const initialRoute = route();
if (initialRoute === 'stems') window.addEventListener('hashchange', () => {
  if (route() !== 'stems') window.location.reload();
});
const sourceName = (source: PlaybackSource): string => source === 'player' ? 'Saved files' : source === 'apple-music' ? 'Apple Music' : source === 'youtube' ? 'YouTube' : 'Spotify';

function PlayerSources(): React.ReactElement {
  const initialSource = initialRoute === 'stems' ? 'player' : initialRoute;
  const [session, dispatch] = useReducer(librarySessionReducer, undefined, () => ({
    source: initialSource,
    destination: initialSource === 'player' ? readLibraryDestination(hasSpotifyTesterAccess()) : initialSource,
    open: initialSource !== 'player',
  }));
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [visited, setVisited] = useState<Record<PlaybackSource, boolean>>({
    player: initialSource === 'player', 'apple-music': initialSource === 'apple-music',
    spotify: initialSource === 'spotify', youtube: initialSource === 'youtube',
  });
  const [providerHost, setProviderHost] = useState<HTMLElement | null>(null);
  const [summary, setSummary] = useState<LibraryPlayerSummary>({ title: 'No media open', source: sourceName(initialSource), playing: false });
  const [request, setRequest] = useState<LocalPlayerRequest>();
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const nextRequest = useRef(0);
  const localContext = useRef<LocalLibraryContext | null>(null);
  const [localInfo, setLocalInfo] = useState<LocalLibraryContext | null>(null);
  const localWait = useRef<{ id: number; reject: (error: Error) => void } | null>(null);
  const pendingActivation = useRef<{ source: PlaybackSource; select: () => void } | null>(null);
  const [activationVersion, setActivationVersion] = useState(0);

  const ensureVisited = useCallback((destination: LibraryDestination | PlaybackSource) => {
    const owner = destination === 'files' || destination === 'classes' ? null : destination;
    if (owner) setVisited(previous => previous[owner] ? previous : { ...previous, [owner]: true });
  }, []);
  const openLibrary = useCallback((destination?: LibraryDestination) => {
    const target = destination ?? sessionRef.current.destination;
    if (target === 'spotify' && !hasSpotifyTesterAccess()) return;
    ensureVisited(target);
    dispatch({ type: 'open', destination: target });
  }, [ensureVisited]);
  const closeLibrary = useCallback(() => dispatch({ type: 'close' }), []);
  const cancelLocalWait = useCallback(() => {
    const pending = localWait.current;
    localWait.current = null;
    pending?.reject(new Error('Opening was canceled because another item was selected.'));
  }, []);
  const activate = useCallback((source: PlaybackSource, select: () => void) => {
    if (source === 'spotify' && !hasSpotifyTesterAccess()) return;
    cancelLocalWait();
    localContext.current = null;
    ensureVisited(source);
    pendingActivation.current = { source, select };
    window.history.pushState(null, '', source === 'player' ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}#${source}`);
    dispatch({ type: 'select', source });
    setActivationVersion(value => value + 1);
  }, [cancelLocalWait, ensureVisited]);
  // Children first suspend the previous source and commit active refs. A selection opens paused,
  // so it needs no delayed Play gesture and cannot make two sources audible together.
  useEffect(() => {
    const pending = pendingActivation.current;
    if (!pending || pending.source !== session.source) return;
    pendingActivation.current = null;
    pending.select();
  }, [activationVersion, session.source]);
  useEffect(() => { rememberLibraryDestination(session.destination); }, [session.destination]);
  useEffect(() => {
    const change = () => {
      const next = route();
      if (next === 'stems' || initialRoute === 'stems') { window.location.reload(); return; }
      pendingActivation.current = null;
      openLibrary(next === 'player' ? 'files' : next);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, [openLibrary]);
  const reportSummary = useCallback((source: PlaybackSource, next: LibraryPlayerSummary) => {
    if (sessionRef.current.source !== source) return;
    setSummary(previous => previous.title === next.title && previous.source === next.source && previous.playing === next.playing ? previous : next);
  }, []);
  const bindings = useMemo(() => {
    const make = (source: Exclude<PlaybackSource, 'player'>): ProviderLibraryBridge => ({
      host: providerHost, visible: session.open && session.destination === source, open: session.open,
      onOpen: openLibrary, onActivate: select => activate(source, select), onSummary: next => reportSummary(source, next),
    });
    return { apple: make('apple-music'), spotify: make('spotify'), youtube: make('youtube') };
  }, [providerHost, session.open, session.destination, openLibrary, activate, reportSummary]);
  const queueLocal = useCallback((selection: Omit<LocalPlayerRequest, 'id'>, wait: boolean): Promise<void> => {
    cancelLocalWait();
    pendingActivation.current = null;
    const id = ++nextRequest.current;
    localContext.current = null;
    setVisited(previous => ({ ...previous, player: true }));
    window.history.pushState(null, '', import.meta.env.BASE_URL);
    dispatch({ type: 'select', source: 'player', keepLibrary: wait });
    setSummary({ title: selection.classSet ? 'Checking class files…' : 'Opening file…', source: 'Saved files', playing: false });
    return new Promise<void>((resolve, reject) => {
      if (wait) localWait.current = { id, reject };
      setRequest({ ...selection, id, onComplete: (error) => {
        if (wait && localWait.current?.id !== id) return;
        if (wait) localWait.current = null;
        if (error) reject(error); else resolve();
      } });
    });
  }, [cancelLocalWait]);
  const openFile = useCallback((file: File) => { void queueLocal({ file }, false).catch(() => {}); }, [queueLocal]);
  const openLocalLibrary = useCallback((view?: LibraryView) => openLibrary(view === 'classes' ? 'classes' : 'files'), [openLibrary]);
  const updateLocalContext = useCallback((context: LocalLibraryContext) => {
    localContext.current = context;
    setLocalInfo(previous => previous?.currentFile === context.currentFile && previous.currentTitle === context.currentTitle
      && previous.currentPractice === context.currentPractice && previous.currentDuration === context.currentDuration
      && previous.activeClassId === context.activeClassId ? previous : context);
  }, []);
  const openFromLocal = useCallback((context: LocalLibraryContext, destination?: LibraryDestination) => {
    updateLocalContext(context);
    openLibrary(destination);
  }, [openLibrary, updateLocalContext]);
  const loadLibraryFile: LocalLibraryContext['onLoad'] = async (file, libraryId, practiceOverride) => {
    if (sessionRef.current.source === 'player' && localContext.current) await localContext.current.onLoad(file, libraryId, practiceOverride);
    else await queueLocal({ file, libraryId, practiceOverride }, true);
  };
  const teachLibraryClass: LocalLibraryContext['onTeachClass'] = async (classSet, entryId) => {
    if (sessionRef.current.source === 'player' && localContext.current) await localContext.current.onTeachClass(classSet, entryId);
    else await queueLocal({ classSet, entryId }, true);
  };
  const current = session.source === 'player' ? localInfo : null;

  return <>
    {visited.player && <App active={session.source === 'player'} request={request} libraryOpen={session.open}
      onOpenLibrary={openFromLocal} onLibraryContext={updateLocalContext} onSummary={next => reportSummary('player', next)} />}
    {visited['apple-music'] && <Suspense fallback={session.destination === 'apple-music' ? <p role="status">Opening Apple Music…</p> : null}>
      <AppleMusic active={session.source === 'apple-music'} library={bindings.apple} onOpenFile={openFile} onOpenLocalLibrary={openLocalLibrary} />
    </Suspense>}
    {visited.spotify && hasSpotifyTesterAccess() && <Suspense fallback={session.destination === 'spotify' ? <p role="status">Opening Spotify…</p> : null}>
      <Spotify active={session.source === 'spotify'} library={bindings.spotify} onOpenFile={openFile} onOpenLocalLibrary={openLocalLibrary}
        onOpenAppleMusic={() => openLibrary('apple-music')} />
    </Suspense>}
    {visited.youtube && <Suspense fallback={session.destination === 'youtube' ? <p role="status">Opening YouTube…</p> : null}>
      <YouTube active={session.source === 'youtube'} library={bindings.youtube} onOpenFile={openFile} onOpenLocalLibrary={openLocalLibrary} />
    </Suspense>}
    <LibraryModal open={session.open} destination={session.destination} onDestinationChange={openLibrary}
      onProviderHost={setProviderHost} playerSummary={summary} onClose={closeLibrary}
      onLoad={loadLibraryFile} onTeachClass={teachLibraryClass} onNotice={setNotice}
      currentFile={current?.currentFile} currentTitle={current?.currentTitle} currentPractice={current?.currentPractice}
      currentDuration={current?.currentDuration} activeClassId={current?.activeClassId} />
    <div className="dancer-toast-region" role="status" aria-live="polite">{notice && <span className="dancer-toast">{notice}</span>}</div>
  </>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {initialRoute === 'stems' ? <Suspense fallback={<p role="status">Opening stems benchmark…</p>}><StemsBenchmark /></Suspense> : <PlayerSources />}
  </StrictMode>,
);
registerSW();
