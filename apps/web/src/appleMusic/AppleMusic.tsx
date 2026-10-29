import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAppleMusicConfig } from './config';
import {
  libraryPlaylists, librarySongs, loadMusicKit, loadSelected, playlistSongs, searchSongs, snapshot,
  type MusicKitInstance, type MusicPlaylist, type MusicTrack,
} from './client';
import { Wordmark, NowPlayingLabel, PlayerTransport } from '../components/PlayerChrome';
import { CuePads } from '../dancer/CuePads';
import { CueStemsSwitch } from '../dancer/CueStemsSwitch';
import { emptyCues, type CueSlots } from '../dancer/cueStore';
import { ACCEPT_MEDIA } from '../dancer/media';
import { StageView } from '../dancer/StageView';
import { createWakeLock } from '../platform/wakeLock';
import { formatTime } from '../types';
import { AppleMusicPicker } from './AppleMusicPicker';
import { loadAppleMusicCues, saveAppleMusicCues } from './cues';
import { createAppleMusicTransport } from './transport';
import { TempoTrial } from './TempoTrial';
import { saveCleanRestart, takeCleanRestart } from './cleanRestart';
import { TempoControl } from '../dancer/TempoControl';
import { LibraryCapability } from '../library/LibraryCapability';
import type { ProviderLibraryBridge } from '../library/navigation';
import type { LibraryView } from '../library/LibraryModal';
import '../shell.css';
import '../dancer/dancer.css';
import '../dancer/classroom.css';
import './appleMusic.css';

type View = 'search' | 'songs' | 'playlists';
type Playback = ReturnType<typeof snapshot>;
const EMPTY: Playback = { isAuthorized: false, isPlaying: false, playbackState: null, currentTime: 0, duration: 0, rate: 1, track: null };
const quietPause = (music: MusicKitInstance, stop = false): void => {
  try { void Promise.resolve(stop ? music.stop() : music.pause()).catch(() => {}); } catch { /* Cleanup must not throw. */ }
};

interface Props {
  active: boolean;
  library: ProviderLibraryBridge;
  onOpenFile: (file: File) => void;
  onOpenLocalLibrary: (view?: LibraryView) => void;
}

/** The ClassTempo player presentation, with Apple owning the protected streaming transport. */
export default function AppleMusic({ active, library, onOpenFile, onOpenLocalLibrary }: Props): React.ReactElement {
  const activeRef = useRef(active);
  const libraryRef = useRef(library);
  activeRef.current = active;
  libraryRef.current = library;
  const [instance, setInstance] = useState<MusicKitInstance | null>(null);
  const [setup, setSetup] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [accessExpired, setAccessExpired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>('search');
  const [query, setQuery] = useState('');
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [playlist, setPlaylist] = useState<MusicPlaylist | null>(null);
  const [searched, setSearched] = useState(false);
  const [playback, setPlayback] = useState<Playback>(EMPTY);
  const [selected, setSelected] = useState<MusicTrack | null>(null);
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null);
  const [stageOpen, setStageOpen] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekRecovery, setSeekRecovery] = useState(false);
  const [cues, setCues] = useState<CueSlots>(emptyCues);
  const [undoCues, setUndoCues] = useState<CueSlots[]>([]);
  const [editing, setEditing] = useState(false);
  const [rename, setRename] = useState<{ index: number; name: string } | null>(null);
  const [screenOn, setScreenOn] = useState(false);
  const [talking, setTalking] = useState(false);
  const talkWasPlaying = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const transportPlayer = useMemo(() => instance ? createAppleMusicTransport(instance, { tempoTrial: true }) : null, [instance]);
  const [wakeLock] = useState(() => {
    const lock = createWakeLock({ onChange: (held) => { setScreenOn(held); if (!held) void lock.disable(); } });
    return lock;
  });
  const alive = useRef(false);
  const requests = useRef(0);
  const transport = useRef(0);
  const accountOperation = useRef(0);
  const accountPending = useRef(false);
  const expiresAt = useRef(0);

  useEffect(() => {
    if (active) return;
    transport.current++;
    // Pause invalidates deferred Play/seek intent while retaining the selected
    // tempo and a paused cue offset. cancel() would discard both.
    try { void Promise.resolve(transportPlayer?.pause()).catch(() => {}); } catch { /* Source suspension must not throw. */ }
    setSeeking(false); setSeekRecovery(false);
    setStageOpen(false); setRename(null); setEditing(false); setTalking(false);
    talkWasPlaying.current = false;
    void wakeLock.disable();
  }, [active, transportPlayer, wakeLock]);

  useEffect(() => () => { transportPlayer?.dispose(); }, [transportPlayer]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => { if (error) setStageOpen(false); }, [error]);
  useEffect(() => {
    if (!seeking) { setSeekRecovery(false); return; }
    const timeout = window.setTimeout(() => {
      if (!activeRef.current || !transportPlayer?.seeking) return;
      transport.current++; transportPlayer?.cancel();
      setSeekRecovery(true); setStageOpen(false); libraryRef.current.onOpen('apple-music');
      setError('Apple Music is taking longer to seek. Reload the connection, or choose another source from Library.');
    }, 15_000);
    return () => window.clearTimeout(timeout);
  }, [seeking, transportPlayer]);
  useEffect(() => () => { void wakeLock.disable(); }, [wakeLock]);

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let current: MusicKitInstance | null = null;
    const abort = new AbortController();
    setSetup('loading'); setError(''); setAccessExpired(false);
    void getAppleMusicConfig(abort.signal).then(async (config) => {
      if (disposed) return;
      expiresAt.current = config.expiresAt;
      const music = await loadMusicKit(config.developerToken);
      if (disposed) return;
      current = music;
      // Reopening this screen never resumes playback by itself.
      try { await music.pause(); music.playbackRate = 1; } catch { throw new Error('Apple Music could not initialize playback. Reload the connection to try again.'); }
      if (disposed) return;
      // Only the live setup consumes this one-shot handoff: StrictMode's discarded
      // setup must not take it. The fresh document has never mounted the local engine.
      const restartTrack = activeRef.current ? takeCleanRestart() : null;
      if (restartTrack) {
        if (!music.isAuthorized) {
          setNotice('Reconnect to Apple Music, then choose the song again. Playback has not started.');
        } else {
          setBusy(true);
          try {
            await loadSelected(music, restartTrack);
            if (disposed) { quietPause(music, true); return; }
            if (!activeRef.current) quietPause(music);
            const next = snapshot(music);
            setSelected(restartTrack);
            setCues(loadAppleMusicCues(restartTrack, next.duration || restartTrack.durationSeconds || 0));
            setUndoCues([]); setEditing(false); setTalking(false); setStageOpen(false);
            if (activeRef.current) libraryRef.current.onActivate(() => {});
          } catch {
            if (!disposed) setError('Apple Music restarted, but the song could not reopen. Choose it again from Library.');
          } finally { if (!disposed) setBusy(false); }
        }
      }
      if (disposed) return;
      setInstance(music); setPlayback(snapshot(music)); setSetup('ready');
    }).catch((caught: unknown) => {
      if (disposed) return;
      setError(caught instanceof Error ? caught.message : 'Apple Music could not be opened. Try again.');
      setSetup('failed');
    });
    return () => {
      disposed = true; alive.current = false; abort.abort(); requests.current++; transport.current++; accountOperation.current++;
      if (current) quietPause(current, true);
    };
  }, [retry]);

  useEffect(() => {
    if (!instance) return;
    let wasAuthorized = instance.isAuthorized;
    let expired = false;
    const clearAccount = () => {
      requests.current++; transport.current++; transportPlayer?.cancel();
      setTracks([]); setPlaylists([]); setPlaylist(null); setSelected(null); setSearched(false);
      setCues(emptyCues()); setUndoCues([]); setEditing(false); setRename(null); setStageOpen(false); setTalking(false);
      if (!accountPending.current) setBusy(false);
      setLoading(false);
    };
    const update = () => {
      const next = snapshot(instance);
      if (wasAuthorized && !next.isAuthorized) clearAccount();
      wasAuthorized = next.isAuthorized;
      setPlayback(next); setSeeking(activeRef.current && (transportPlayer?.seeking ?? false));
      if (!expired && expiresAt.current <= Date.now() / 1000 + 60) {
        expired = true;
        setAccessExpired(true);
        requests.current++; transport.current++; accountOperation.current++;
        accountPending.current = false; setBusy(false); setLoading(false);
        transportPlayer?.cancel(); quietPause(instance); setRename(null); setStageOpen(false);
        if (activeRef.current) libraryRef.current.onOpen('apple-music');
        setError('Apple Music access needs to be renewed. Return to local files, or reopen this screen after the app is updated.');
      }
    };
    const failure = () => {
      transport.current++;
      transportPlayer?.cancel(); quietPause(instance); setRename(null); setStageOpen(false); setTalking(false);
      if (!accountPending.current) setBusy(false);
      setError('Apple Music could not play this song. Check your connection and subscription, then choose the song again.');
    };
    const authorization = () => update();
    const interval = window.setInterval(update, 250);
    instance.addEventListener('mediaPlaybackError', failure);
    instance.addEventListener('authorizationStatusDidChange', authorization);
    return () => {
      window.clearInterval(interval);
      instance.removeEventListener('mediaPlaybackError', failure);
      instance.removeEventListener('authorizationStatusDidChange', authorization);
    };
  }, [instance, transportPlayer]);

  const connect = (): void => {
    if (!instance || busy || accessExpired || accountPending.current) return;
    setBusy(true); setError(''); setNotice('');
    // Must be called directly in the tap handler, with SDK setup already complete.
    const id = ++accountOperation.current;
    accountPending.current = true;
    let authorization: Promise<unknown>;
    try { authorization = instance.authorize(); } catch { accountPending.current = false; setBusy(false); setError('Sign-in could not open. Try again in Safari.'); return; }
    void authorization.then(() => {
      if (!alive.current || id !== accountOperation.current) return;
      setPlayback(snapshot(instance));
      setNotice(instance.isAuthorized ? 'Connected. Search for a song, or open your Apple Music library.' : 'Sign-in was not completed. Tap Connect Apple Music to try again.');
    }).catch(() => {
      if (alive.current && id === accountOperation.current) setError('Apple Music sign-in did not finish. Try again and allow Apple’s sign-in window.');
    }).finally(() => { if (alive.current && id === accountOperation.current) { accountPending.current = false; setBusy(false); } });
  };

  const disconnect = (): void => {
    if (!instance || accountPending.current || transportPlayer?.seeking) return;
    const id = ++accountOperation.current;
    accountPending.current = true;
    requests.current++; transport.current++;
    setBusy(true); setLoading(false); setError('');
    transportPlayer?.cancel(); quietPause(instance, true);
    let signingOut: Promise<void>;
    try { signingOut = instance.unauthorize(); } catch { accountPending.current = false; setBusy(false); setError('Apple Music could not disconnect. Try again while online.'); return; }
    void signingOut.then(() => {
      if (!alive.current || id !== accountOperation.current) return;
      setTracks([]); setPlaylists([]); setPlaylist(null); setSelected(null); setSearched(false);
      setCues(emptyCues()); setUndoCues([]); setEditing(false); setRename(null); setStageOpen(false); setTalking(false);
      setPlayback(snapshot(instance)); setNotice('Disconnected from Apple Music. Your local files and classes are unchanged.');
    }).catch(() => { if (alive.current && id === accountOperation.current) setError('Apple Music could not disconnect. Try again while online.'); })
      .finally(() => { if (alive.current && id === accountOperation.current) { accountPending.current = false; setBusy(false); } });
  };

  const browse = async (next: View, chosenPlaylist: MusicPlaylist | null = null): Promise<void> => {
    if (!instance?.isAuthorized || accessExpired || accountPending.current || (next === 'search' && !query.trim())) return;
    const id = ++requests.current;
    setView(next); setPlaylist(chosenPlaylist); setLoading(true); setError(''); setNotice('');
    setTracks([]); setPlaylists([]); setSearched(true);
    try {
      if (next === 'playlists' && !chosenPlaylist) {
        const items = await libraryPlaylists(instance);
        if (id === requests.current && alive.current) setPlaylists(items);
      } else {
        const items = next === 'search' ? await searchSongs(instance, query.trim())
          : chosenPlaylist ? await playlistSongs(instance, chosenPlaylist.id) : await librarySongs(instance);
        if (id === requests.current && alive.current) setTracks(items);
      }
    } catch {
      if (id === requests.current && alive.current) setError('Could not load Apple Music results. Check your connection, or disconnect and sign in again.');
    } finally {
      if (id === requests.current && alive.current) setLoading(false);
    }
  };

  const choose = async (track: MusicTrack): Promise<void> => {
    if (!activeRef.current || !instance || busy || accessExpired || accountPending.current || transportPlayer?.seeking) return;
    const id = ++transport.current;
    transportPlayer?.cancel();
    setBusy(true); setError(''); setNotice('');
    try {
      await loadSelected(instance, track);
      if (id !== transport.current || !alive.current || !activeRef.current) { quietPause(instance); return; }
      const next = snapshot(instance);
      setSelected(track); setPlayback(next);
      setCues(loadAppleMusicCues(track, next.duration || track.durationSeconds || 0));
      setUndoCues([]); setEditing(false); setTalking(false); setStageOpen(false);
      setNotice('');
    } catch {
      if (id === transport.current && alive.current && activeRef.current) {
        setSelected(null); setError('This song could not be opened. Try another song or check your Apple Music subscription.');
        libraryRef.current.onOpen('apple-music');
      }
    } finally { if (alive.current) setBusy(accountPending.current); }
  };

  const action = (operation: () => void | Promise<unknown>): void => {
    if (!activeRef.current || !instance || !playback.isAuthorized || accessExpired || accountPending.current) return;
    setError(''); setNotice('');
    const id = ++transport.current;
    try {
      // Play/seek is invoked before any await, preserving the original gesture.
      void Promise.resolve(operation()).catch(() => {
        if (alive.current && id === transport.current && activeRef.current) setError('Playback did not complete that action. Try Play again, or choose another song.');
      });
      setPlayback(snapshot(instance));
    } catch { setError('This playback control is not available right now. Try Play again.'); }
  };

  const hasSong = !!selected && playback.isAuthorized && !accessExpired;
  const duration = playback.duration || selected?.durationSeconds || 0;
  const position = Math.max(0, Math.min(duration, transportPlayer?.preparedPosition ?? playback.currentTime));
  const shownTrack = selected;
  const artworkUrl = shownTrack?.artworkUrl !== failedArtworkUrl ? shownTrack?.artworkUrl : undefined;
  const blocked = !active || busy || seeking || setup !== 'ready' || !hasSong;
  const playDisabled = !active || busy || !hasSong || (seeking && !playback.isPlaying);
  const tempoPercent = Math.round((transportPlayer?.requestedRate ?? 1) * 100);
  useEffect(() => {
    if (active) libraryRef.current.onSummary({ title: shownTrack?.name || 'No song open', source: 'Apple Music', playing: playback.isPlaying });
  }, [active, shownTrack?.name, playback.isPlaying]);
  const cleanRestart = (): boolean => {
    if (!activeRef.current || !instance || !selected || blocked || accountPending.current) return false;
    // Preserve the selection before interrupting playback. Storage failure must not
    // turn a diagnostic action into a lost song or an unannounced source switch.
    if (!saveCleanRestart(selected)) return false;
    transport.current++; transportPlayer?.cancel(); quietPause(instance, true);
    try {
      // A hash change alone retains the AudioContext. Reload after setting the route
      // so the new document starts directly in Apple Music without mounting App.
      window.history.replaceState(null, '', `${import.meta.env.BASE_URL}#apple-music`);
      window.location.reload();
      return true;
    } catch {
      takeCleanRestart(); // Do not leave a delayed restore request after a refused reload.
      return false;
    }
  };
  const changeTempo = (percent: number): void => {
    if (!activeRef.current || !transportPlayer || blocked || transportPlayer.seeking) return;
    action(() => transportPlayer.setTempoRate(percent / 100));
  };

  const togglePlay = (): void => {
    if (!activeRef.current || !transportPlayer || !hasSong || busy) return;
    setTalking(false);
    if (playback.isPlaying) { action(() => transportPlayer.pause()); }
    else if (!seeking && !transportPlayer.seeking) action(() => transportPlayer.play());
  };
  const seek = (seconds: number): void => {
    if (!activeRef.current || !transportPlayer || blocked || transportPlayer.seeking || !Number.isFinite(seconds)) return;
    setTalking(false); setSeeking(true); setSeekRecovery(false);
    const id = ++transport.current;
    setError(''); setNotice('');
    const target = Math.max(0, Math.min(duration, seconds));
    void transportPlayer.seek(target, selected ? { id: selected.id, durationSeconds: duration } : undefined).then(() => {
      if (!alive.current || id !== transport.current || !activeRef.current || !instance) return;
      setPlayback(snapshot(instance));
    }).catch(() => {
      if (alive.current && id === transport.current && activeRef.current) setError('Could not move to that position. Try again while connected.');
    }).finally(() => {
      if (!alive.current || id !== transport.current || !activeRef.current) return;
      setSeeking(transportPlayer.seeking); setSeekRecovery(false);
    });
  };
  const changeCues = (next: CueSlots, remember = true): boolean => {
    if (!activeRef.current || !selected || !hasSong || blocked) return false;
    if (remember) setUndoCues((previous) => [...previous.slice(-9), cues]);
    setCues(next);
    const saved = saveAppleMusicCues(selected, duration, next);
    if (!saved) setNotice('Cues work now, but could not be saved on this device.');
    return saved;
  };
  const pressCue = (index: number): void => {
    if (!activeRef.current || blocked || !selected) return;
    const cue = cues[index];
    if (!cue || editing) {
      const saved = changeCues(cues.map((item, slot) => slot === index ? { time: position, name: item?.name || `Cue ${index + 1}` } : item));
      if (saved) setNotice(`Cue ${index + 1} set at ${formatTime(position)}.`);
    } else seek(cue.time);
  };
  const toggleTalk = (): void => {
    if (!activeRef.current || !transportPlayer || blocked) return;
    if (talking) {
      setTalking(false);
      if (talkWasPlaying.current) action(() => transportPlayer.play());
    } else {
      talkWasPlaying.current = playback.isPlaying;
      setTalking(true); action(() => transportPlayer.pause());
    }
  };
  const openFile = (): void => fileInput.current?.click();
  const toggleWake = (): void => {
    if (!activeRef.current) return;
    if (screenOn) { setScreenOn(false); void wakeLock.disable(); }
    else void wakeLock.enable().then((held) => {
      if (activeRef.current) setScreenOn(held);
      else void wakeLock.disable();
    });
  };
  const closeStage = (): void => {
    setStageOpen(false);
    requestAnimationFrame(() => { if (activeRef.current) document.querySelector<HTMLButtonElement>('.apple-music-app .stage-open')?.focus(); });
  };
  const keyActions = useRef({ pickerOpen: library.open, renameOpen: !!rename, stageOpen, cues, pressCue, seek, togglePlay });
  keyActions.current = { pickerOpen: library.open, renameOpen: !!rename, stageOpen, cues, pressCue, seek, togglePlay };
  useEffect(() => {
    let handledSpace = false;
    const onKeyDown = (event: KeyboardEvent): void => {
      const latest = keyActions.current;
      if (!activeRef.current || event.defaultPrevented || latest.pickerOpen || latest.renameOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .dancer-actions, .resume-audio')) return;
      // Focused controls keep their native Space/Home behavior. Stage additionally
      // stops these events at its own controls before they reach this listener.
      if ((event.key === ' ' || event.key === 'Home') && target?.closest('button, a, [role="button"]')) return;
      if (event.key.length === 1 && event.key >= '1' && event.key <= '8') {
        if (!event.repeat) {
          const index = Number(event.key) - 1;
          if (latest.stageOpen) { const cue = latest.cues[index]; if (cue) latest.seek(cue.time); }
          else latest.pressCue(index);
        }
      } else if (event.key === ' ') {
        handledSpace = true;
        if (!event.repeat) latest.togglePlay();
      } else if (event.key === 'Home') {
        if (!event.repeat) latest.seek(0);
      } else return;
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === ' ' && handledSpace) { handledSpace = false; event.preventDefault(); }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, []);
  const feedback = <>{error && <p className="apple-music-error" role="alert">{error}</p>}{notice && <p className="apple-music-notice" role="status">{notice}</p>}</>;
  return <>
    <div className="app apple-music-app" hidden={!active}>
      <header><div className="head-left"><Wordmark className="logo" /></div><div className="header-actions"><div className="dancer-actions">
        <button type="button" onClick={openFile} disabled={busy} title="Open a song or video file">Open</button>
        <button type="button" onClick={() => library.onOpen()} disabled={busy} title="Saved files, class plans and streaming sources">Library</button>
        {wakeLock.supported && <button type="button" className={`screen-on ${screenOn ? 'on' : ''}`} onClick={toggleWake} aria-pressed={screenOn} aria-label="Keep awake" title="Prevents dimming and auto-lock while ClassTempo is visible">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
          <span className="screen-on-label">Keep awake</span>
        </button>}
        <input ref={fileInput} type="file" accept={ACCEPT_MEDIA} hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onOpenFile(file); }} />
      </div></div></header>
      <main className="dancer-main">
        <section className={`dancer apple-music-dancer ${editing ? 'editing' : ''}`} aria-label="Apple Music player">
          <div className="dancer-clock"><span className="elapsed">{formatTime(position)}</span><span className="total">/ {formatTime(duration)}</span><span className="bpm"><span className="big">{tempoPercent}%</span><span className="unit">tempo</span></span></div>
          <div className={`dancer-media-panel ${artworkUrl ? 'has-artwork' : ''}`}>
            <div className="dancer-track-info"><NowPlayingLabel /><div className="dancer-track-title" title={shownTrack?.name}>{busy ? 'Opening song…' : shownTrack?.name ?? 'Choose a song from your library'}</div>{shownTrack && <div className="apple-music-artist">{shownTrack.artist}</div>}</div>
            <div className="apple-music-artwork">
              {artworkUrl ? <img src={artworkUrl} alt={`${shownTrack?.album || shownTrack?.name} artwork`} onError={() => setFailedArtworkUrl(artworkUrl)} /> : <span aria-hidden="true">♫</span>}
              {!hasSong && <button type="button" onClick={() => library.onOpen('apple-music')}>Choose Apple Music song</button>}
            </div>
            <div className="apple-music-timeline"><input type="range" min="0" max={Math.max(1, duration)} step="1" value={position} aria-label="Song position" disabled={blocked || !duration} onChange={(event) => seek(Number(event.target.value))} /></div>
          </div>
          <PlayerTransport playing={playback.isPlaying} disabled={blocked} playDisabled={playDisabled} onTogglePlay={togglePlay} onRestart={() => seek(0)} onStage={() => { setEditing(false); setStageOpen(true); }} />
          <div className="class-tempo-panel apple-music-tools">
            <TempoControl value={tempoPercent} onChange={changeTempo} disabled={blocked} inputId="apple-music-tempo" keyLocked={false} />
            <div className="apple-music-tool-buttons"><button type="button" disabled={blocked} onClick={() => seek(position - 10)}>↶ Back 10s</button><button type="button" disabled={blocked} className={talking ? 'on' : ''} aria-pressed={talking} title="Pause while you speak; tap again to resume" onClick={toggleTalk}>{talking ? 'Finish talking' : 'Talk'}</button>{active && <TempoTrial instance={instance} trackId={selected?.id ?? null} requestedRate={transportPlayer?.requestedRate ?? 1} playing={playback.isPlaying} seeking={seeking} onCleanRestart={cleanRestart} restartDisabled={blocked} />}</div>
          </div>
          <div className={`cues ${undoCues.length ? 'has-undo' : ''}`}>
            <div className="cues-head"><CueStemsSwitch value="cues" onChange={() => {}} stemsDisabled /><span className="cues-hint">{editing ? 'Tap to move' : 'Tap empty to set'}</span>{undoCues.length > 0 && <button type="button" className="cues-undo" disabled={blocked} onClick={() => { const previous = undoCues[undoCues.length - 1]; if (previous) { changeCues(previous, false); setUndoCues((items) => items.slice(0, -1)); } }}>Undo</button>}<button type="button" disabled={blocked} onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit cues'}</button></div>
            <CuePads cues={cues} launchLabel="Go to cue" editing={editing} disabled={blocked} onPress={pressCue} onClear={(index) => changeCues(cues.map((cue, slot) => slot === index ? null : cue))} onRename={(index) => setRename({ index, name: cues[index]?.name || '' })} />
            <p className="apple-music-cue-help">Cues keep playing or stay paused.</p>
          </div>
          <div className="apple-music-capabilities">{!library.open && (error || notice || seeking) ? <div className="apple-music-feedback">{feedback}{seeking && !error && <p role="status">Moving to position…</p>}</div> : <p>Practice and Stems use <button type="button" onClick={() => onOpenLocalLibrary('media')} disabled={busy}>local files</button>.</p>}</div>
        </section>
      </main>
    </div>
    {library.visible && library.host && createPortal(<section className="apple-music-library" aria-label="Apple Music library">
      <h3>Apple Music</h3>
      <LibraryCapability destination="apple-music" />
      <div className="apple-music-account"><span>{playback.isAuthorized ? 'Connected to Apple Music' : 'Apple Music'}</span>{playback.isAuthorized && <button type="button" onClick={disconnect} disabled={busy || seeking}>Disconnect</button>}</div>
      <p className="apple-music-limits">Stream with your Apple Music subscription. Internet required.</p>
      {feedback}
      {setup === 'loading' && <div><p role="status">Opening Apple Music…</p><button type="button" onClick={() => window.location.reload()}>Reload connection</button></div>}
      {(accessExpired || seekRecovery) && <button type="button" onClick={() => window.location.reload()}>Reload connection</button>}
      {accountPending.current && busy && <button type="button" onClick={() => window.location.reload()}>Cancel connection attempt</button>}
      {setup === 'failed' && <div className="apple-music-setup"><h3>Apple Music could not connect</h3><p>Check your internet connection and try again.</p><button type="button" onClick={() => setRetry(retry + 1)}>Try again</button></div>}
      {setup === 'ready' && !playback.isAuthorized && !accessExpired && <section className="apple-music-connect"><span aria-hidden="true">♫</span><h3>Your music, through Apple</h3><p>Sign in on Apple’s secure page. ClassTempo does not see your password or save streaming songs.</p><button className="apple-music-primary" type="button" onClick={connect} disabled={busy}>{busy ? 'Waiting for Apple…' : 'Connect Apple Music'}</button></section>}
      {playback.isAuthorized && !accessExpired && <section className="apple-music-browser" aria-label="Find Apple Music songs">
        <div className="apple-music-tabs" role="group" aria-label="Apple Music collection">
          <button type="button" aria-pressed={view === 'search'} onClick={() => { requests.current++; setView('search'); setPlaylist(null); setTracks([]); setPlaylists([]); setSearched(false); setLoading(false); }}>Search</button>
          <button type="button" aria-pressed={view === 'songs'} onClick={() => void browse('songs')}>My songs</button>
          <button type="button" aria-pressed={view === 'playlists'} onClick={() => void browse('playlists')}>Playlists</button>
        </div>
        {view === 'search' && <form className="apple-music-search" onSubmit={(event) => { event.preventDefault(); void browse('search'); }}><label htmlFor="apple-music-search">Search Apple Music<input id="apple-music-search" type="search" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} placeholder="Song or artist" autoComplete="off" /></label><button type="submit" disabled={!query.trim() || loading}>Search</button></form>}
        {playlist && <button className="apple-music-playlist-back" type="button" onClick={() => void browse('playlists')}>← All playlists</button>}
        {playlist && <div><h3>{playlist.name}</h3><p className="apple-music-limits">Choose one song to open paused. Manage this playlist in the Apple Music app.</p></div>}
        <div className="apple-music-results" aria-busy={loading}>
          {loading ? <p role="status">Loading…</p> : <>
            {tracks.length > 0 && <ul>{tracks.map((track) => <li key={`${track.type}:${track.id}`}><button type="button" disabled={busy || seeking || !!transportPlayer?.seeking} onClick={() => library.onActivate(() => { void choose(track); })} aria-label={`Open ${track.name} by ${track.artist}`}>
              {track.artworkUrl ? <img src={track.artworkUrl} alt="" width="48" height="48" loading="lazy" /> : <span className="apple-music-art-placeholder" aria-hidden="true">♫</span>}
              <span><strong>{track.name}</strong><small>{track.artist}{track.album ? ` · ${track.album}` : ''}</small></span><span aria-hidden="true">›</span>
            </button></li>)}</ul>}
            {playlists.length > 0 && <ul>{playlists.map((item) => <li key={item.id}><button type="button" onClick={() => void browse('playlists', item)}><span className="apple-music-art-placeholder" aria-hidden="true">≡</span><span><strong>{item.name}</strong><small>Browse songs</small></span><span aria-hidden="true">›</span></button></li>)}</ul>}
            {searched && !tracks.length && !playlists.length && !error && <p>No {view === 'playlists' && !playlist ? 'playlists' : 'songs'} found.{view === 'search' ? ' Try a different song or artist.' : ''}</p>}
            {!searched && <p>Find a song, then tap it to open in the player.</p>}
            {(tracks.length > 0 || playlists.length > 0) && <p className="apple-music-list-note">Showing the first 25 {view === 'playlists' && !playlist ? 'playlists' : 'songs'}.</p>}
          </>}
        </div>
      </section>}
    </section>, library.host)}
    {active && rename && <AppleMusicPicker title="Rename cue" onClose={() => setRename(null)}><form className="apple-music-rename" onSubmit={(event) => { event.preventDefault(); const name = rename.name.trim().slice(0, 40); if (!name) return; changeCues(cues.map((cue, index) => index === rename.index && cue ? { ...cue, name } : cue)); setRename(null); }}><label>Cue name<input value={rename.name} maxLength={40} onChange={(event) => setRename({ ...rename, name: event.target.value })} /></label><button type="submit" disabled={!rename.name.trim()}>Save name</button></form></AppleMusicPicker>}
    {active && stageOpen && hasSong && shownTrack && <StageView video={null} aspect={null} title={shownTrack.name} artworkUrl={shownTrack.artworkUrl} artist={shownTrack.artist} playing={playback.isPlaying} position={position} duration={duration} cues={cues} section="Apple Music" tempo={tempoPercent} onTempoChange={changeTempo} onTogglePlay={togglePlay} onRestart={() => seek(0)} onLaunch={(index) => { const cue = cues[index]; if (cue) seek(cue.time); }} onSetCue={pressCue} talking={talking} onToggleTalk={toggleTalk} onClose={closeStage} onSeek={seek} cueActionLabel="Go to" disabled={blocked} playDisabled={playDisabled} />}
  </>;
}
