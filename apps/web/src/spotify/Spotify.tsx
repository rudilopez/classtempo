import { useEffect, useMemo, useRef, useState } from 'react';
import { AppleMusicPicker } from '../appleMusic/AppleMusicPicker';
import { Wordmark, NowPlayingLabel, PlayerTransport } from '../components/PlayerChrome';
import { CuePads } from '../dancer/CuePads';
import { CueStemsSwitch } from '../dancer/CueStemsSwitch';
import { emptyCues, type CueSlots } from '../dancer/cueStore';
import { ACCEPT_MEDIA } from '../dancer/media';
import { StageView } from '../dancer/StageView';
import { createWakeLock } from '../platform/wakeLock';
import { formatTime } from '../types';
import spotifyLogo from '../assets/spotify-logo.svg';
import { getSpotifyConfig } from './config';
import { beginSpotifyAuth, completeSpotifyAuth, disconnectSpotify, hasSpotifyCallback, hasSpotifySession } from './auth';
import {
  createSpotifyPlayer, playlists as getPlaylists, playlistTracks, savedTracks, searchTracks,
  type MusicTrack, type MusicPlaylist, type SpotifyPlayer, type SpotifySnapshot,
} from './client';
import { createSpotifyTransport } from './transport';
import { clearSpotifyCues, loadSpotifyCues, saveSpotifyCues } from './cues';
import '../shell.css';
import '../dancer/dancer.css';
import '../dancer/classroom.css';
import '../appleMusic/appleMusic.css';
import './spotify.css';

interface Props {
  onOpenFile: (file: File) => void;
  onOpenLocalLibrary: () => void;
  onOpenAppleMusic: () => void;
}
type View = 'search' | 'songs' | 'playlists';
const EMPTY: SpotifySnapshot = { ready: false, playing: false, position: 0, duration: 0, trackId: null };
const TRANSFER_GUIDE = 'https://support.apple.com/en-us/118249';
const PRIVACY_PAGE = `${import.meta.env.BASE_URL}spotify-privacy.html`;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SpotifyLink({ track, className = '' }: { track?: MusicTrack | null; className?: string }): React.ReactElement {
  return <a className={`spotify-attribution ${className}`} href={track?.externalUrl ?? 'https://open.spotify.com/'} target="_blank" rel="noopener noreferrer" aria-label={track ? `Open ${track.name} in Spotify` : 'Open Spotify'}>
    <img src={spotifyLogo} alt="Spotify" />
    <span aria-hidden="true">↗</span>
  </a>;
}

/** Spotify owns playback. This screen never sends its protected media to the local engine. */
export default function Spotify({ onOpenFile, onOpenLocalLibrary, onOpenAppleMusic }: Props): React.ReactElement {
  const [config] = useState(getSpotifyConfig);
  const [accepted, setAccepted] = useState(false);
  const [authorized, setAuthorized] = useState(hasSpotifySession);
  const [authBusy, setAuthBusy] = useState(false);
  const [player, setPlayer] = useState<SpotifyPlayer | null>(null);
  const [setup, setSetup] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [retry, setRetry] = useState(0);
  const [playback, setPlayback] = useState<SpotifySnapshot>(EMPTY);
  const [selected, setSelected] = useState<MusicTrack | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(true);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [view, setView] = useState<View>('search');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [cues, setCues] = useState<CueSlots>(emptyCues);
  const [undoCues, setUndoCues] = useState<CueSlots[]>([]);
  const [editing, setEditing] = useState(false);
  const [rename, setRename] = useState<{ index: number; name: string } | null>(null);
  const [talking, setTalking] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const operation = useRef(0);
  const cancelRequested = useRef(false);
  const browseRequest = useRef<AbortController | null>(null);
  const talkWasPlaying = useRef(false);
  const transport = useMemo(() => player ? createSpotifyTransport(player) : null, [player]);
  const [wakeLock] = useState(() => {
    const lock = createWakeLock({ onChange: (held) => { setScreenOn(held); if (!held) void lock.disable(); } });
    return lock;
  });

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current++; browseRequest.current?.abort(); void wakeLock.disable(); };
  }, [wakeLock]);
  useEffect(() => () => { transport?.dispose(); }, [transport]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Finish the redirect the user previously requested, while still showing the
  // original-speed introduction. Neither auth completion nor Continue starts audio.
  useEffect(() => {
    let cancelled = false;
    const callback = hasSpotifyCallback();
    if (callback) setAuthBusy(true);
    // Call even after the query has been cleaned: StrictMode's second effect
    // must join an exchange already in flight instead of losing its result.
    void completeSpotifyAuth().then(() => {
      if (cancelled) return;
      setAuthorized(hasSpotifySession());
      if (callback) setNotice('Connected. Continue when you are ready to choose a song.');
    }).catch((caught: unknown) => {
      if (!cancelled) setError(errorMessage(caught, 'Spotify sign-in did not finish. Try connecting again.'));
    }).finally(() => { if (!cancelled) setAuthBusy(false); });
    return () => { cancelled = true; };
  }, []);

  // The SDK loads only after explicit Continue and a valid authorized session.
  useEffect(() => {
    if (!accepted || !authorized || !config) return;
    let cancelled = false;
    let current: SpotifyPlayer | null = null;
    setSetup('loading'); setError('');
    void createSpotifyPlayer(
      (next) => { if (!cancelled) setPlayback(next); },
      (message) => { if (!cancelled) { setError(message); setStageOpen(false); } },
    ).then((next) => {
      if (cancelled) { next.dispose(); return; }
      current = next;
      setPlayer(next); setPlayback(next.snapshot()); setSetup('ready');
    }).catch((caught: unknown) => {
      if (!cancelled) { setSetup('failed'); setError(errorMessage(caught, 'Spotify could not start. Try connecting again.')); }
    });
    return () => { cancelled = true; current?.dispose(); };
  }, [accepted, authorized, config, retry]);

  const hasSong = authorized && selected !== null;
  const matchingTrack = selected !== null && playback.trackId === selected.id;
  const playing = hasSong && matchingTrack && playback.playing;
  const duration = selected?.durationSeconds ?? 0;
  const position = Math.max(0, Math.min(duration, transport?.preparedPosition ?? (matchingTrack ? playback.position : 0)));
  const blocked = busy || transport?.pending === true || !hasSong || setup !== 'ready' || !playback.ready;
  const playDisabled = !hasSong || setup !== 'ready' || !playback.ready || cancelling || ((busy || transport?.pending === true) && !playing && !pendingPlay);
  const artworkUrl = selected?.artworkUrl && selected.artworkUrl !== failedArtwork ? selected.artworkUrl : undefined;

  const leave = (next: () => void): void => {
    operation.current++; browseRequest.current?.abort(); transport?.cancel();
    next();
  };
  const openFile = (): void => fileInput.current?.click();
  const filePicker = <input ref={fileInput} type="file" accept={ACCEPT_MEDIA} hidden onChange={(event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) leave(() => onOpenFile(file));
  }} />;
  const connect = (): void => {
    if (!config || authBusy) return;
    setAuthBusy(true); setError('');
    void beginSpotifyAuth().catch((caught: unknown) => {
      if (alive.current) { setAuthBusy(false); setError(errorMessage(caught, 'Spotify sign-in could not open. Try again.')); }
    });
  };
  const disconnect = (): void => {
    operation.current++; browseRequest.current?.abort(); transport?.dispose();
    disconnectSpotify(); clearSpotifyCues();
    setPlayer(null); setPlayback(EMPTY); setAuthorized(false); setSetup('idle');
    setSelected(null); setTracks([]); setPlaylists([]); setPlaylist(null); setSearched(false);
    setCues(emptyCues()); setUndoCues([]); setEditing(false); setRename(null); setTalking(false);
    setStageOpen(false); setPickerOpen(true); setBusy(false); setLoading(false); setError('');
    setPendingPlay(false); setCancelling(false);
    setNotice('Disconnected. Spotify bookmarks on this device were removed.');
  };
  const browse = async (next: View, chosen: MusicPlaylist | null = null): Promise<void> => {
    if (!authorized || (next === 'search' && !query.trim())) return;
    browseRequest.current?.abort();
    const controller = new AbortController(); browseRequest.current = controller;
    setView(next); setPlaylist(chosen); setLoading(true); setSearched(true); setError('');
    setTracks([]); setPlaylists([]);
    try {
      if (next === 'playlists' && !chosen) {
        const items = await getPlaylists(controller.signal);
        if (!controller.signal.aborted && alive.current) setPlaylists(items);
      } else {
        const items = next === 'search' ? await searchTracks(query.trim(), controller.signal)
          : chosen ? await playlistTracks(chosen.id, controller.signal) : await savedTracks(controller.signal);
        if (!controller.signal.aborted && alive.current) setTracks(items);
      }
    } catch (caught: unknown) {
      if (!controller.signal.aborted && alive.current) setError(errorMessage(caught, 'Spotify could not load this list. Try again.'));
    } finally { if (!controller.signal.aborted && alive.current) setLoading(false); }
  };
  const choose = (track: MusicTrack): void => {
    if (busy || transport?.pending) return;
    operation.current++; transport?.cancel();
    setSelected(track); setPlayback((previous) => ({ ...EMPTY, ready: previous.ready }));
    setCues(loadSpotifyCues(track, track.durationSeconds)); setUndoCues([]); setEditing(false);
    setTalking(false); setStageOpen(false); setError(''); setNotice(''); setPickerOpen(false);
  };
  const action = (run: () => Promise<void>, startsPlayback = false): void => {
    const id = ++operation.current;
    setError(''); setNotice(''); setBusy(true);
    setPendingPlay(startsPlayback); setCancelling(false); cancelRequested.current = false;
    try {
      // Invoke synchronously so Play reaches activateElement inside this gesture.
      void run().catch((caught: unknown) => {
        if (alive.current && id === operation.current && !cancelRequested.current) setError(errorMessage(caught, 'Spotify could not complete that action. Try again.'));
      }).finally(() => {
        if (!alive.current || id !== operation.current) return;
        if (player) setPlayback(player.snapshot());
        setBusy(false); setPendingPlay(false); setCancelling(false);
      });
    } catch (caught: unknown) {
      if (alive.current && id === operation.current) { setBusy(false); setPendingPlay(false); setCancelling(false); setError(errorMessage(caught, 'Spotify could not complete that action.')); }
    }
  };
  const togglePlay = (): void => {
    if (!transport || !selected || cancelling) return;
    if (pendingPlay) {
      // Keep this operation busy until its real completion. Cancellation revokes
      // transport intent immediately; a late Spotify response cannot restart it.
      cancelRequested.current = true;
      transport.cancel(); setPendingPlay(false); setCancelling(true); setTalking(false);
      return;
    }
    if ((busy || transport.pending) && !playing) return;
    setTalking(false);
    action(() => playing ? transport.pause() : transport.play(selected), !playing);
  };
  const seek = (seconds: number): void => {
    if (!transport || blocked || !Number.isFinite(seconds)) return;
    setTalking(false);
    action(() => transport.seek(Math.max(0, Math.min(duration, seconds)), playing));
  };
  const changeCues = (next: CueSlots, remember = true): void => {
    if (!selected || blocked) return;
    if (remember) setUndoCues((previous) => [...previous.slice(-9), cues]);
    setCues(next);
    if (!saveSpotifyCues(selected, duration, next)) setNotice('Cues work now, but could not be saved on this device.');
  };
  const pressCue = (index: number): void => {
    if (blocked) return;
    const cue = cues[index];
    if (!cue || editing) changeCues(cues.map((item, slot) => slot === index ? { time: position, name: item?.name || `Cue ${index + 1}` } : item));
    else seek(cue.time);
  };
  const toggleTalk = (): void => {
    if (!transport || !selected || blocked) return;
    if (talking) {
      setTalking(false);
      if (talkWasPlaying.current) action(() => transport.play(selected), true);
    } else {
      talkWasPlaying.current = playing;
      setTalking(true); action(() => transport.pause());
    }
  };
  const toggleWake = (): void => {
    if (screenOn) { setScreenOn(false); void wakeLock.disable(); }
    else void wakeLock.enable().then(setScreenOn);
  };
  const closeStage = (): void => {
    setStageOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.spotify-app .stage-open')?.focus());
  };
  const shortcuts = useRef({ accepted, pickerOpen, optionsOpen, rename, stageOpen, pressCue, togglePlay, seek });
  shortcuts.current = { accepted, pickerOpen, optionsOpen, rename, stageOpen, pressCue, togglePlay, seek };
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      const current = shortcuts.current;
      if (!current.accepted || current.pickerOpen || current.optionsOpen || current.rename || event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])')) return;
      if (/^[1-8]$/.test(event.key)) current.pressCue(Number(event.key) - 1);
      else if (event.key === ' ') current.togglePlay();
      else if (event.key === 'Home') current.seek(0);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);

  const feedback = <>{error && <p className="apple-music-error" role="alert">{error}</p>}{notice && <p className="apple-music-notice" role="status">{notice}</p>}</>;
  const limitations = <>
    <div className="spotify-speed-intro"><strong>100%</strong><span>Original speed only</span></div>
    <p>Spotify songs play at their recorded tempo. Speed changes, Practice, Stems, class plans and offline playback are unavailable.</p>
    <p><strong>Spotify Premium and an internet connection are required.</strong></p>
    <p className="spotify-use-note">Spotify is for personal, non-commercial listening. This connection is not for teaching a class or other public playback.</p>
    <p className="apple-music-limits">Development access is limited to Spotify accounts approved for this app. <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">Spotify connection privacy ↗</a></p>
  </>;
  const alternatives = <div className="spotify-alternatives">
    <button type="button" onClick={() => leave(onOpenAppleMusic)}>Use Apple Music</button>
    <p>For tempo controls, use Apple Music in ClassTempo. <a href={TRANSFER_GUIDE} target="_blank" rel="noopener noreferrer">How to transfer Spotify playlists to Apple Music ↗</a></p>
    <div><button type="button" onClick={openFile}>Open a file</button><button type="button" onClick={() => leave(onOpenLocalLibrary)}>Files &amp; classes</button></div>
  </div>;

  if (!accepted) return <>
    <div className="app spotify-app"><header><Wordmark className="logo" /></header></div>
    <AppleMusicPicker title="Spotify" onClose={() => leave(onOpenLocalLibrary)}>
      <div className="spotify-intro">
        <div className="spotify-intro-top"><SpotifyLink /><strong className="spotify-speed-badge">100%</strong><a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">Privacy ↗</a></div>
        <ul className="spotify-intro-limits">
          <li>Original speed only. No tempo changes, Practice, Stems, class plans or offline playback.</li>
          <li>Personal, non-commercial listening only. Not for teaching a class or public playback.</li>
        </ul>
        <p className="spotify-intro-requires">Premium · Internet · Approved test account</p>
        {feedback}
        {!config && <p className="spotify-setup-note">Spotify connection needs setup. Use another music source below for now.</p>}
        {authBusy && <p role="status">Finishing Spotify sign-in…</p>}
        <button type="button" className="apple-music-primary" disabled={!config || authBusy} onClick={() => { setAccepted(true); setPickerOpen(true); }}>Continue at 100%</button>
        <button type="button" className="spotify-intro-apple" onClick={() => leave(onOpenAppleMusic)}><span>Use Apple Music</span><small>Tempo controls</small></button>
        <a className="spotify-transfer-link" href={TRANSFER_GUIDE} target="_blank" rel="noopener noreferrer">Transfer Spotify playlists to Apple Music ↗</a>
        <div className="spotify-intro-files"><button type="button" onClick={openFile}>Open a file</button><button type="button" onClick={() => leave(onOpenLocalLibrary)}>Files &amp; classes</button></div>
        {filePicker}
      </div>
    </AppleMusicPicker>
  </>;

  return <>
    <div className="app apple-music-app spotify-app">
      <header><div className="head-left"><Wordmark className="logo" /></div><div className="header-actions"><div className="dancer-actions">
        <button type="button" onClick={openFile}>Open</button>
        <button type="button" onClick={() => setPickerOpen(true)}>Library</button>
        {wakeLock.supported && <button type="button" className={`screen-on ${screenOn ? 'on' : ''}`} aria-pressed={screenOn} onClick={toggleWake} title="Prevents dimming and auto-lock while ClassTempo is visible">☀<span className="screen-on-label">Keep awake</span></button>}
        {filePicker}
      </div></div></header>
      <main className="dancer-main"><section className={`dancer apple-music-dancer spotify-dancer ${editing ? 'editing' : ''}`} aria-label="Spotify player">
        <div className="dancer-clock"><span className="elapsed">{formatTime(position)}</span><span className="total">/ {formatTime(duration)}</span><span className="bpm"><span className="big">100%</span><span className="unit">tempo</span></span></div>
        <div className="dancer-media-panel spotify-media-panel">
          <div className="spotify-track-heading"><div className="dancer-track-info"><NowPlayingLabel /><div className="dancer-track-title" title={selected?.name}>{selected?.name ?? 'Choose a Spotify song'}</div>{selected && <div className="apple-music-artist">{selected.artist}</div>}</div><SpotifyLink track={selected} /></div>
          <div className="apple-music-artwork spotify-artwork">{artworkUrl ? <a href={selected?.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${selected?.name} in Spotify`}><img src={artworkUrl} alt={`${selected?.album || selected?.name} artwork`} onError={() => setFailedArtwork(artworkUrl)} /></a> : !hasSong ? <button type="button" onClick={() => setPickerOpen(true)}>Choose a song</button> : <span aria-hidden="true">♫</span>}</div>
          <div className="apple-music-timeline"><input type="range" min="0" max={Math.max(1, duration)} step="1" value={position} aria-label="Song position" disabled={blocked || !duration} onChange={(event) => seek(Number(event.target.value))} /></div>
        </div>
        <PlayerTransport playing={playing} disabled={blocked} playDisabled={playDisabled} playLabel={pendingPlay ? 'Cancel start' : cancelling ? 'Stopping…' : undefined} playDetail={pendingPlay ? 'Connecting playback…' : undefined} onTogglePlay={togglePlay} onRestart={() => seek(0)} onStage={() => { setEditing(false); setStageOpen(true); }} />
        <div className="class-tempo-panel spotify-tools">
          <div className="spotify-speed"><span>Tempo</span><button type="button" disabled aria-label="Spotify tempo is fixed at 100 percent">100%</button><small>Original speed only</small></div>
          <div className="apple-music-tool-buttons"><button type="button" disabled={blocked} onClick={() => seek(position - 10)}>↶ Back 10s</button><button type="button" disabled={blocked} className={talking ? 'on' : ''} aria-pressed={talking} onClick={toggleTalk}>{talking ? 'Finish talking' : 'Talk'}</button><button type="button" onClick={() => setOptionsOpen(true)}>Options</button></div>
        </div>
        <div className={`cues ${undoCues.length ? 'has-undo' : ''}`}>
          <div className="cues-head"><CueStemsSwitch value="cues" onChange={() => {}} stemsDisabled /><span className="cues-hint">{editing ? 'Tap to move' : 'Tap empty to set'}</span>{undoCues.length > 0 && <button type="button" className="cues-undo" disabled={blocked} onClick={() => { const previous = undoCues[undoCues.length - 1]; if (previous) { changeCues(previous, false); setUndoCues((items) => items.slice(0, -1)); } }}>Undo</button>}<button type="button" disabled={blocked} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit cues'}</button></div>
          <CuePads cues={cues} editing={editing} disabled={blocked} onPress={pressCue} onClear={(index) => changeCues(cues.map((cue, slot) => slot === index ? null : cue))} onRename={(index) => setRename({ index, name: cues[index]?.name ?? '' })} />
          <p className="apple-music-cue-help">Cues keep playing or stay paused.</p>
        </div>
        <div className="apple-music-capabilities">{!pickerOpen && (error || notice) ? <div className="apple-music-feedback">{feedback}</div> : <p>Spotify · Personal listening at original speed.</p>}</div>
      </section></main>
    </div>
    {pickerOpen && <AppleMusicPicker title="Library" onClose={() => setPickerOpen(false)}>
      <div className="apple-music-sources spotify-sources" role="group" aria-label="Music source"><button type="button" onClick={() => leave(onOpenLocalLibrary)}>Files &amp; classes</button><button type="button" onClick={() => leave(onOpenAppleMusic)}>Apple Music</button><button type="button" aria-pressed="true">Spotify</button></div>
      <div className="apple-music-account"><SpotifyLink />{authorized && <button type="button" onClick={disconnect}>Disconnect</button>}</div>
      <p className="apple-music-limits">Original speed · Personal listening only · Premium required</p>
      {feedback}
      {!authorized && <section className="apple-music-connect"><h3>Connect your Spotify account</h3><p>Sign in on Spotify’s secure page. Songs open paused, ready for you to press Play.</p><p className="apple-music-limits">Development access is limited to approved test accounts. <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">Spotify connection privacy ↗</a></p><button type="button" className="apple-music-primary" disabled={authBusy || !config} onClick={connect}>{authBusy ? 'Opening Spotify…' : 'Connect Spotify'}</button></section>}
      {authorized && setup === 'loading' && <p role="status">Starting the Spotify player…</p>}
      {authorized && (setup === 'failed' || (setup === 'ready' && !playback.ready)) && <button type="button" onClick={() => { setPlayer(null); setRetry((value) => value + 1); }}>Retry Spotify player</button>}
      {authorized && <section className="apple-music-browser" aria-label="Find Spotify songs">
        <div className="apple-music-tabs" role="group" aria-label="Spotify collection">
          <button type="button" aria-pressed={view === 'search'} onClick={() => { browseRequest.current?.abort(); setView('search'); setPlaylist(null); setTracks([]); setPlaylists([]); setSearched(false); setLoading(false); }}>Search</button>
          <button type="button" aria-pressed={view === 'songs'} onClick={() => void browse('songs')}>Saved songs</button>
          <button type="button" aria-pressed={view === 'playlists'} onClick={() => void browse('playlists')}>Playlists</button>
        </div>
        {view === 'search' && <form className="apple-music-search" onSubmit={(event) => { event.preventDefault(); void browse('search'); }}><label htmlFor="spotify-search">Search Spotify<input id="spotify-search" type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="Song or artist" autoComplete="off" /></label><button type="submit" disabled={!query.trim() || loading}>Search</button></form>}
        {playlist && <><button type="button" className="apple-music-playlist-back" onClick={() => void browse('playlists')}>← All playlists</button><h3>{playlist.name}</h3></>}
        <div className="apple-music-results" aria-busy={loading}>{loading ? <p role="status">Loading…</p> : <>
          {tracks.length > 0 && <ul>{tracks.map((track) => <li key={track.id} className="spotify-result-row"><button type="button" disabled={busy || setup !== 'ready'} onClick={() => choose(track)} aria-label={`Open ${track.name} by ${track.artist}`}>
            {track.artworkUrl ? <img src={track.artworkUrl} alt="" width="48" height="48" loading="lazy" /> : <span className="apple-music-art-placeholder" aria-hidden="true">♫</span>}<span><strong>{track.name}</strong><small>{track.artist}</small></span><span aria-hidden="true">›</span>
          </button><a href={track.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${track.name} on Spotify`}>Spotify ↗</a></li>)}</ul>}
          {playlists.length > 0 && <ul>{playlists.map((item) => <li key={item.id} className="spotify-result-row"><button type="button" onClick={() => void browse('playlists', item)}><span className="apple-music-art-placeholder" aria-hidden="true">≡</span><span><strong>{item.name}</strong><small>Open playlist</small></span><span aria-hidden="true">›</span></button><a href={`https://open.spotify.com/playlist/${item.id}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${item.name} on Spotify`}>Spotify ↗</a></li>)}</ul>}
          {searched && !tracks.length && !playlists.length && !error && <p>No {view === 'playlists' && !playlist ? 'playlists' : 'songs'} found. {view === 'search' ? 'Try another song or artist.' : ''}</p>}
          {!searched && <p>Find a song, then tap it to open paused.</p>}
          {(tracks.length > 0 || playlists.length > 0) && <p className="apple-music-list-note">Showing up to {view === 'search' ? '10 search results' : '20 items'}.</p>}
        </>}</div>
      </section>}
      <button type="button" onClick={() => { setPickerOpen(false); setOptionsOpen(true); }}>Spotify limits &amp; other options</button>
    </AppleMusicPicker>}
    {optionsOpen && <AppleMusicPicker title="Spotify options" onClose={() => setOptionsOpen(false)}><SpotifyLink />{limitations}{alternatives}</AppleMusicPicker>}
    {rename && <AppleMusicPicker title="Rename cue" onClose={() => setRename(null)}><form className="apple-music-rename" onSubmit={(event) => { event.preventDefault(); const name = rename.name.trim().slice(0, 40); if (!name) return; changeCues(cues.map((cue, index) => index === rename.index && cue ? { ...cue, name } : cue)); setRename(null); }}><label>Cue name<input value={rename.name} maxLength={40} onChange={(event) => setRename({ ...rename, name: event.target.value })} /></label><button type="submit" disabled={!rename.name.trim()}>Save name</button></form></AppleMusicPicker>}
    {stageOpen && selected && <StageView video={null} aspect={null} title={selected.name} artist={selected.artist} artworkUrl={artworkUrl} artworkTreatment="original" sourceLink={{ label: 'Open Spotify', href: selected.externalUrl, logoUrl: spotifyLogo }} playing={playing} position={position} duration={duration} cues={cues} section="Spotify · Original speed" tempo={100} pendingLabel={pendingPlay ? 'Starting…' : cancelling ? 'Stopping…' : null} onTogglePlay={togglePlay} onRestart={() => seek(0)} onLaunch={(index) => { const cue = cues[index]; if (cue) seek(cue.time); }} onSetCue={pressCue} onClose={closeStage} onSeek={seek} talking={talking} onToggleTalk={toggleTalk} disabled={blocked} playDisabled={playDisabled} cueActionLabel="Go to" />}
  </>;
}
