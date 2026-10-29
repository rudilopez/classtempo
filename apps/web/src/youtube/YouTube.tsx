import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppleMusicPicker } from '../appleMusic/AppleMusicPicker';
import { Wordmark, NowPlayingLabel, PlayerTransport } from '../components/PlayerChrome';
import { CuePads, padColor } from '../dancer/CuePads';
import { CueStemsSwitch } from '../dancer/CueStemsSwitch';
import { emptyCues, type CueSlots } from '../dancer/cueStore';
import { ACCEPT_MEDIA } from '../dancer/media';
import { createWakeLock } from '../platform/wakeLock';
import { LibraryHome, type LibraryDestination } from '../library/LibraryHome';
import type { LibraryView } from '../library/LibraryModal';
import { formatTime } from '../types';
import { createYouTubePlayer, type YouTubePlayer, type YouTubeSnapshot } from './client';
import { loadYouTubeCues, saveYouTubeCues } from './cues';
import { parseYouTubeVideo, type YouTubeVideo } from './video';
import '../shell.css';
import '../dancer/dancer.css';
import '../appleMusic/appleMusic.css';
import './youtube.css';

interface Props {
  active: boolean;
  onOpenFile: (file: File) => void;
  onOpenLocalLibrary: (view?: LibraryView) => void;
}

const EMPTY: YouTubeSnapshot = {
  ready: false, videoId: null, title: '', duration: 0, position: 0,
  playing: false, rate: 1, rates: [1], blocked: false,
};
const PRIVACY_PAGE = `${import.meta.env.BASE_URL}youtube-privacy.html`;

/** The official visible YouTube player owns audio, picture, controls and supported speeds. */
export default function YouTube({ active, onOpenFile, onOpenLocalLibrary }: Props): React.ReactElement {
  const [url, setUrl] = useState('');
  const [selected, setSelected] = useState<YouTubeVideo | null>(null);
  const [snapshot, setSnapshot] = useState<YouTubeSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickerOpen, setPickerOpen] = useState(true);
  const [libraryHome, setLibraryHome] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rename, setRename] = useState<{ index: number; name: string } | null>(null);
  const [stage, setStage] = useState(false);
  const [tray, setTray] = useState<'cues' | 'tools' | null>(null);
  const [cues, setCues] = useState<CueSlots>(emptyCues);
  const [undo, setUndo] = useState<CueSlots[]>([]);
  const [talking, setTalking] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const activeRef = useRef(active);
  const modalRef = useRef(false);
  const talkWasPlaying = useRef(false);
  activeRef.current = active;
  const modalOpen = pickerOpen || optionsOpen || editing;
  modalRef.current = modalOpen;
  const [wakeLock] = useState(() => createWakeLock({ onChange: held => setScreenOn(held) }));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; generation.current++; request.current?.abort();
      player.current?.dispose(); player.current = null; void wakeLock.disable();
    };
  }, [wakeLock]);

  // Keep UI metadata between sources, but never keep a hidden YouTube frame alive.
  useLayoutEffect(() => {
    if (active) return;
    generation.current++; request.current?.abort(); request.current = null;
    player.current?.dispose(); player.current = null;
    setSnapshot(EMPTY); setLoading(false); setStage(false); setTray(null);
    setEditing(false); setRename(null); setOptionsOpen(false); setLibraryHome(false); setPickerOpen(true);
    setTalking(false); setScreenOn(false); void wakeLock.disable();
  }, [active, wakeLock]);

  useLayoutEffect(() => {
    if (modalOpen) { player.current?.pause(); setTalking(false); }
  }, [modalOpen]);

  useEffect(() => {
    const hide = () => {
      if (document.visibilityState !== 'visible') { player.current?.pause(); setTalking(false); }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (stage) exitButton.current?.focus();
  }, [stage]);

  const matching = selected !== null && snapshot.videoId === selected.id;
  const position = matching ? Math.max(0, snapshot.position) : selected?.startSeconds ?? 0;
  const duration = matching ? Math.max(0, snapshot.duration) : 0;
  const playing = matching && snapshot.playing;
  const ready = matching && snapshot.ready && !loading;
  const title = matching && snapshot.title ? snapshot.title : selected ? 'YouTube video' : 'Open a YouTube video';

  const leave = (next: () => void): void => {
    player.current?.pause(); setTalking(false); next();
  };
  const showPicker = (home = false): void => {
    player.current?.pause(); setTalking(false); setLibraryHome(home); setPickerOpen(true);
  };
  const showOptions = (): void => {
    player.current?.pause(); setTalking(false); setOptionsOpen(true);
  };
  const openFile = (): void => {
    player.current?.pause(); setTalking(false); fileInput.current?.click();
  };
  const closeStage = (): void => {
    setStage(false); setTray(null);
    requestAnimationFrame(() => stageButton.current?.focus());
  };
  const seek = (seconds: number): void => {
    if (!ready || !Number.isFinite(seconds)) return;
    setTalking(false); player.current?.seek(Math.max(0, duration ? Math.min(duration, seconds) : seconds), playing);
  };
  const togglePlay = (): void => {
    if (!ready || modalRef.current || !activeRef.current) return;
    setTalking(false);
    if (playing) player.current?.pause();
    else player.current?.play();
  };
  const toggleTalk = (): void => {
    if (!ready) return;
    if (!talking) { talkWasPlaying.current = playing; player.current?.pause(); setTalking(true); }
    else { setTalking(false); if (talkWasPlaying.current) player.current?.play(); }
  };
  const changeCues = (next: CueSlots, remember = true): void => {
    if (!selected) return;
    if (remember) setUndo(items => [...items.slice(-19), cues]);
    setCues(next);
    if (!saveYouTubeCues(selected.id, duration, next)) setNotice('Cues work now, but could not be saved in this browser.');
  };
  const pressCue = (index: number): void => {
    if (!ready) return;
    const cue = cues[index];
    if (cue && !editing) seek(cue.time);
    else changeCues(cues.map((item, slot) => slot === index ? { time: position, name: item?.name ?? `Cue ${index + 1}` } : item));
  };
  const toggleWake = (): void => {
    if (screenOn) { setScreenOn(false); void wakeLock.disable(); }
    else void wakeLock.enable().then(held => { if (alive.current && activeRef.current) setScreenOn(held); });
  };

  async function openVideo(input = url): Promise<void> {
    const video = parseYouTubeVideo(input);
    if (!video) { setError('Paste a YouTube video link, such as a watch, share or Shorts link.'); return; }
    const id = ++generation.current;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    player.current?.dispose(); player.current = null;
    setError(''); setNotice(''); setLoading(true); setSnapshot(EMPTY);
    setSelected(video); setUrl(video.url);
    setCues(loadYouTubeCues(video.id, 0)); setUndo([]); setEditing(false); setRename(null);
    setPickerOpen(false); modalRef.current = false; setOptionsOpen(false); setTalking(false);
    try {
      if (!host.current) throw new Error('The video player is not available. Reopen YouTube and try again.');
      const current = await createYouTubePlayer(host.current, next => {
          if (id !== generation.current || controller.signal.aborted) return;
          if (!alive.current || !activeRef.current) { player.current?.pause(); return; }
          if (next.playing && (modalRef.current || document.visibilityState !== 'visible')) {
            player.current?.pause(); return;
          }
          if (next.playing) { setTalking(false); setError(''); }
          setSnapshot(next);
        }, message => {
          if (alive.current && activeRef.current && id === generation.current && !controller.signal.aborted) { setError(message); setLoading(false); setTalking(false); }
        }, controller.signal, video);
      if (!alive.current || !activeRef.current || id !== generation.current || controller.signal.aborted) { current.dispose(); return; }
      player.current = current;
      current.cue(video.id, video.startSeconds);
      setSnapshot(current.snapshot()); setLoading(false);
    } catch (cause) {
      if (!alive.current || !activeRef.current || id !== generation.current || controller.signal.aborted) return;
      setLoading(false); setError(cause instanceof Error ? cause.message : 'YouTube could not open. Try again.');
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const commandRef = useRef({ togglePlay, seek, position, pressCue, stage, tray, closeStage });
  commandRef.current = { togglePlay, seek, position, pressCue, stage, tray, closeStage };
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalRef.current || event.altKey || event.ctrlKey || event.metaKey) return;
      const current = commandRef.current;
      if (event.key === 'Escape' && current.stage) {
        event.preventDefault(); if (current.tray) setTray(null); else current.closeStage(); return;
      }
      if (event.target instanceof HTMLElement && (event.target.closest('button, input, select, textarea, a, [contenteditable]') || event.target.tagName === 'IFRAME')) return;
      if (event.key === ' ') { event.preventDefault(); current.togglePlay(); }
      else if (/^[1-8]$/.test(event.key)) { event.preventDefault(); current.pressCue(Number(event.key) - 1); }
      else if (event.key === 'Home') { event.preventDefault(); current.seek(0); }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [active]);

  const chooseLibrary = (destination: LibraryDestination): void => {
    if (destination === 'youtube') { setLibraryHome(false); return; }
    if (destination === 'files' || destination === 'classes') {
      leave(() => onOpenLocalLibrary(destination === 'files' ? 'media' : 'classes')); return;
    }
    leave(() => { window.location.hash = destination; });
  };
  const speedControls = <>
    <label className="youtube-speed">Speed<select aria-label="YouTube playback speed" value={snapshot.rate} disabled={!ready} onChange={event => player.current?.setRate(Number(event.target.value))}>
      {[...new Set([...snapshot.rates, snapshot.rate])].sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{Math.round(rate * 100)}%</option>)}
    </select></label>
    <button type="button" disabled={!ready} aria-pressed={talking} onClick={toggleTalk}>{talking ? 'Finish talking' : 'Talk'}</button>
    <button type="button" onClick={showOptions}>Options</button>
  </>;
  const compactCues = <div className="youtube-cue-row" role="group" aria-label="Video cues">
    {cues.map((cue, index) => <button key={index} type="button" disabled={!ready} className={cue ? 'set' : ''}
      style={{ ['--pad' as string]: padColor(index) }} onClick={() => pressCue(index)}
      aria-label={cue ? `Go to ${cue.name}, ${formatTime(cue.time)}` : `Set cue ${index + 1} at the current position`}
      title={cue ? `${cue.name} · ${formatTime(cue.time)}` : `Set cue ${index + 1}`}>
      <strong>{index + 1}{cue ? '' : ' +'}</strong><small>{cue ? formatTime(cue.time) : 'Set'}</small>
    </button>)}
    {stage && <button type="button" disabled={!ready} onClick={() => { player.current?.pause(); setEditing(true); }}>Edit</button>}
  </div>;

  return <>
    <div className={`app youtube-app ${stage ? 'youtube-stage' : ''} ${modalOpen ? 'youtube-modal-open' : ''}`} hidden={!active}>
      <header><Wordmark className="logo" /><div className="header-actions"><div className="dancer-actions">
        <button type="button" onClick={openFile}>Open</button>
        <button type="button" onClick={() => showPicker(true)}>Library</button>
        {wakeLock.supported && <button type="button" className={`screen-on ${screenOn ? 'on' : ''}`} aria-pressed={screenOn} onClick={toggleWake} title="Prevents dimming and auto-lock while ClassTempo is visible">☀<span className="screen-on-label">Keep awake</span></button>}
      </div></div></header>
      <input ref={fileInput} type="file" accept={ACCEPT_MEDIA} hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) leave(() => onOpenFile(file)); }} />
      <main className="youtube-main"><section className="youtube-player" aria-label={stage ? 'YouTube Stage' : 'YouTube player'}>
        <div className="youtube-now"><div><NowPlayingLabel /><strong title={title}>{title}</strong></div><a href={selected?.url ?? 'https://www.youtube.com/'} target="_blank" rel="noopener noreferrer">YouTube ↗</a></div>
        <div className="youtube-picture">
          <div className="youtube-host" ref={host} />
          {!selected && <div className="youtube-empty"><span aria-hidden="true">▶</span><button type="button" onClick={() => showPicker()}>Paste a YouTube link</button><p>Open a video, then press Play.</p></div>}
        </div>
        <div className="youtube-main-transport" hidden={stage}><PlayerTransport playing={playing} disabled={!ready} onTogglePlay={togglePlay} onRestart={() => seek(0)} stageRef={stageButton} onStage={() => { setStage(true); setTray(null); }} /></div>
        <div className="youtube-stage-dock" hidden={!stage}>
          <button type="button" className="youtube-primary" disabled={!ready} onClick={togglePlay}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <button type="button" aria-expanded={tray === 'cues'} onClick={() => setTray(tray === 'cues' ? null : 'cues')}>Cues</button>
          <button type="button" aria-expanded={tray === 'tools'} onClick={() => setTray(tray === 'tools' ? null : 'tools')}>Tools</button>
          <button ref={exitButton} type="button" onClick={closeStage}>Exit</button>
        </div>
        <div className="youtube-timeline"><span>{formatTime(position)} / {formatTime(duration)}</span><input type="range" aria-label="Video position" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(position, Math.max(1, duration))} disabled={!ready || duration <= 0} onChange={event => seek(Number(event.target.value))} /></div>
        <div className="youtube-tools" hidden={stage && tray !== 'tools'}>{stage && <button type="button" disabled={!ready} onClick={() => seek(0)}>⟲ Restart</button>}{speedControls}</div>
        <div className="youtube-cues-heading" hidden={stage}><CueStemsSwitch value="cues" onChange={() => {}} stemsDisabled />
          {undo.length > 0 && <button type="button" disabled={!ready} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { changeCues(previous, false); setUndo(items => items.slice(0, -1)); } }}>Undo</button>}
          <button type="button" disabled={!ready} onClick={() => { player.current?.pause(); setEditing(true); }}>Edit cues</button>
        </div>
        <div className="youtube-cues" hidden={stage && tray !== 'cues'}>{compactCues}</div>
        {(loading || error || notice || snapshot.blocked && !playing) && <div className="youtube-feedback" role={error ? 'alert' : 'status'}>
          {loading ? 'Opening YouTube…' : error || notice || 'Tap Play in the YouTube video to allow playback.'}
          {error && selected && <><button type="button" onClick={() => void openVideo(selected.url)}>Retry video</button><a href={selected.url} target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a></>}
        </div>}
      </section></main>
    </div>
    {active && pickerOpen && <AppleMusicPicker title={libraryHome ? 'Library' : 'YouTube'} onClose={() => setPickerOpen(false)}>
      {libraryHome ? <><LibraryHome onChoose={chooseLibrary} onOpenFile={openFile} /><a className="library-guide-link" href={`${import.meta.env.BASE_URL}guide.html`} target="_blank" rel="noopener noreferrer">How to use ClassTempo ↗</a></> : <>
      <button type="button" className="library-source-back" onClick={() => setLibraryHome(true)}>← Back to Library</button>
      <form className="youtube-open-form" onSubmit={event => { event.preventDefault(); void openVideo(); }}>
        <h3>Open a YouTube video</h3><p>Paste a video link from YouTube or its Share button. It opens paused.</p>
        <label>YouTube link<input type="text" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} maxLength={2048} placeholder="https://youtu.be/…" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
        {error && <p className="apple-music-error" role="alert">{error}</p>}
        <button type="submit" className="apple-music-primary" disabled={!url.trim() || loading}>Open video</button>
      </form>
      <p className="apple-music-limits">Opening a video connects to YouTube. No ClassTempo key or YouTube account is required. Videos may contain ads or be unavailable for embedding.</p>
      <p className="apple-music-limits">Cues and YouTube-supported speeds are available. Practice, classes, Stems and offline playback use imported files. <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">YouTube privacy ↗</a></p>
      </>}
    </AppleMusicPicker>}
    {active && optionsOpen && <AppleMusicPicker title="YouTube options" onClose={() => setOptionsOpen(false)}>
      <p>YouTube controls the available speeds, picture, ads and video availability. The speed selector shows the rate YouTube reports.</p>
      <p className="apple-music-limits">Keep the video visible and the app open. YouTube playback pauses when you leave this source or hide the app.</p>
      <p className="apple-music-limits">Practice, class plans, Stems, mirroring and offline playback use imported files. YouTube cues are saved in this browser, separately from your files and music services.</p>
      {selected && <a href={selected.url} target="_blank" rel="noopener noreferrer">Open this video on YouTube ↗</a>}
      <a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">YouTube connection privacy ↗</a>
      <button type="button" onClick={() => { setOptionsOpen(false); showPicker(); }}>Open another YouTube link</button>
      <button type="button" onClick={() => leave(onOpenLocalLibrary)}>Library</button>
    </AppleMusicPicker>}
    {active && editing && <AppleMusicPicker title="Edit YouTube cues" onClose={() => { setEditing(false); setRename(null); }}>
      <p className="apple-music-limits">Tap a pad to move it to {formatTime(position)}. Rename or clear a saved cue below.</p>
      <div className="youtube-edit-cues"><CuePads cues={cues} editing disabled={!ready} onPress={pressCue} onClear={index => changeCues(cues.map((cue, slot) => slot === index ? null : cue))} onRename={index => setRename({ index, name: cues[index]?.name ?? '' })} /></div>
      {rename && <form className="apple-music-rename" onSubmit={event => { event.preventDefault(); const name = rename.name.trim().slice(0, 40); if (!name) return; changeCues(cues.map((cue, slot) => slot === rename.index && cue ? { ...cue, name } : cue)); setRename(null); }}>
        <label>Cue name<input value={rename.name} maxLength={40} onChange={event => setRename({ ...rename, name: event.target.value })} /></label><button type="submit" disabled={!rename.name.trim()}>Save name</button>
      </form>}
      {undo.length > 0 && <button type="button" onClick={() => { const previous = undo[undo.length - 1]; if (previous) { changeCues(previous, false); setUndo(items => items.slice(0, -1)); } }}>Undo</button>}
      <button type="button" className="apple-music-primary" onClick={() => { setEditing(false); setRename(null); }}>Done</button>
    </AppleMusicPicker>}
  </>;
}
