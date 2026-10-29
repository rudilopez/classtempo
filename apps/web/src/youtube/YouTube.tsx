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
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
const fullscreenElement = (): Element | null => document.fullscreenElement ?? (document as FullscreenDocument).webkitFullscreenElement ?? null;

function exitOwnedFullscreen(element: HTMLElement | null): void {
  if (!element || fullscreenElement() !== element) return;
  try {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else (document as FullscreenDocument).webkitExitFullscreen?.();
  } catch { /* The CSS Stage still closes when browser fullscreen is unavailable. */ }
}

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
  const [talkMuted, setTalkMuted] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const fullscreenOwner = useRef<HTMLElement | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const optionsDone = useRef<HTMLButtonElement>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const alive = useRef(false);
  const activeRef = useRef(active);
  const modalRef = useRef(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  activeRef.current = active;
  const modalOpen = pickerOpen || editing;
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
    exitOwnedFullscreen(fullscreenOwner.current);
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
  useEffect(() => {
    if (optionsOpen) optionsDone.current?.focus();
  }, [optionsOpen]);
  useEffect(() => {
    const changed = () => {
      if (fullscreenOwner.current && fullscreenElement() === null) { fullscreenOwner.current = null; setStage(false); setTray(null); }
    };
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('webkitfullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('webkitfullscreenchange', changed);
      exitOwnedFullscreen(fullscreenOwner.current);
    };
  }, []);

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
    player.current?.pause(); setTalking(false); setOptionsOpen(false); setLibraryHome(home); setPickerOpen(true);
  };
  const showOptions = (): void => {
    setOptionsOpen(!optionsOpen);
  };
  const openFile = (): void => {
    player.current?.pause(); setTalking(false); fileInput.current?.click();
  };
  const closeStage = (): void => {
    exitOwnedFullscreen(fullscreenOwner.current);
    setStage(false); setTray(null); setOptionsOpen(false);
    requestAnimationFrame(() => stageButton.current?.focus());
  };
  const enterStage = (): void => {
    setStage(true); setTray(null); setOptionsOpen(false);
    const root = document.documentElement as FullscreenElement;
    if (fullscreenElement()) return;
    try {
      // Request directly in the Stage tap. iPhone Safari falls back to the full-viewport CSS layout.
      // The document owns fullscreen so body-level cue/library dialogs remain reachable above Stage.
      if (root.requestFullscreen) {
        fullscreenOwner.current = root;
        void root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          if (!activeRef.current || !stageRef.current) exitOwnedFullscreen(root);
        }).catch(() => { fullscreenOwner.current = null; });
      }
      else if (root.webkitRequestFullscreen) { fullscreenOwner.current = root; root.webkitRequestFullscreen(); }
    } catch { fullscreenOwner.current = null; /* The same iframe remains in CSS Stage. */ }
  };
  const closeOptions = (): void => {
    setOptionsOpen(false);
    requestAnimationFrame(() => optionsButton.current?.focus());
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
    const next = !talking;
    if (player.current?.setDucked(next)) { setTalking(next); setTalkMuted(player.current.talkMuted); }
    else setNotice('This browser could not lower YouTube’s volume. Use your device volume controls.');
  };
  const changeRate = (rate: number): void => {
    if (!ready) return;
    setTalking(false); player.current?.setRate(rate);
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
          setTalking(player.current?.ducked ?? false);
          setTalkMuted(player.current?.talkMuted ?? false);
          if (next.playing) setError('');
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

  const commandRef = useRef({ togglePlay, seek, position, pressCue, stage, tray, closeStage, optionsOpen, closeOptions });
  commandRef.current = { togglePlay, seek, position, pressCue, stage, tray, closeStage, optionsOpen, closeOptions };
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalRef.current || event.altKey || event.ctrlKey || event.metaKey) return;
      const current = commandRef.current;
      if (event.key === 'Escape' && current.optionsOpen) { event.preventDefault(); current.closeOptions(); return; }
      if (event.key === 'Escape' && current.stage) {
        event.preventDefault(); if (current.tray) setTray(null); else current.closeStage(); return;
      }
      if (event.target instanceof HTMLElement && (event.target.closest('button, input, select, textarea, a, summary, [contenteditable]') || event.target.tagName === 'IFRAME')) return;
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
  const supportedRates = [...new Set([...snapshot.rates, snapshot.rate])].sort((a, b) => a - b);
  const slower = supportedRates.filter(rate => rate < snapshot.rate).at(-1);
  const faster = supportedRates.find(rate => rate > snapshot.rate);
  const speedControls = <>
    <div className="youtube-tempo">
      <label htmlFor="youtube-tempo">Tempo</label>
      <button type="button" className="tempo-nudge" disabled={!ready || slower === undefined} aria-label="Slower YouTube speed" title="Previous supported speed" onClick={() => slower !== undefined && changeRate(slower)}>−</button>
      <select id="youtube-tempo" className="youtube-tempo-select" aria-label="YouTube playback speed" value={snapshot.rate} disabled={!ready} onChange={event => changeRate(Number(event.target.value))}>
        {supportedRates.map(rate => <option key={rate} value={rate}>{Math.round(rate * 100)}%</option>)}
      </select>
      <button type="button" className="tempo-nudge" disabled={!ready || faster === undefined} aria-label="Faster YouTube speed" title="Next supported speed" onClick={() => faster !== undefined && changeRate(faster)}>+</button>
    </div>
    <div className="youtube-tool-buttons">
      {stage && <button type="button" disabled={!ready} onClick={() => seek(0)}>⟲ Restart</button>}
      <button type="button" disabled={!ready || !playing && !talking} aria-pressed={talking} title="Quiet the audio while the video keeps playing; tap again to restore" onClick={toggleTalk}><span>{talking ? 'Finish talking' : 'Talk'}</span>{talking && <small>{talkMuted ? 'Audio muted' : 'Audio lowered'}</small>}</button>
      <button ref={optionsButton} type="button" aria-expanded={optionsOpen} onClick={showOptions}>Options</button>
    </div>
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
        <div className="youtube-clock dancer-clock"><span className="elapsed">{formatTime(position)}</span><span className="total">/ {formatTime(duration)}</span><span className="bpm"><span className="big">{Math.round(snapshot.rate * 100)}%</span><span className="unit">tempo</span></span></div>
        <div className="youtube-media-panel dancer-media-panel">
          <div className="youtube-now"><div><NowPlayingLabel /><strong title={title}>{title}</strong></div><a href={selected?.url ?? 'https://www.youtube.com/'} target="_blank" rel="noopener noreferrer">YouTube ↗</a></div>
          <div className="youtube-picture">
            <div className="youtube-host" ref={host} />
            {!selected && <div className="youtube-empty"><span aria-hidden="true">▶</span><button type="button" onClick={() => showPicker()}>Paste a YouTube link</button><p>Open a video, then press Play.</p></div>}
          </div>
          <div className="youtube-timeline"><span>{formatTime(position)} / {formatTime(duration)}</span><input type="range" aria-label="Video position" min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(position, Math.max(1, duration))} disabled={!ready || duration <= 0} onChange={event => seek(Number(event.target.value))} /></div>
        </div>
        <div className="youtube-main-transport" hidden={stage}><PlayerTransport playing={playing} disabled={!ready} onTogglePlay={togglePlay} onRestart={() => seek(0)} stageRef={stageButton} onStage={enterStage} /></div>
        <div className="youtube-stage-dock" hidden={!stage}>
          <button type="button" className="youtube-primary" disabled={!ready} onClick={togglePlay}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          <input className="youtube-stage-seek" type="range" aria-label="Stage video position" aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`} min="0" max={Math.max(1, duration)} step="0.1" value={Math.min(position, Math.max(1, duration))} disabled={!ready || duration <= 0} onChange={event => seek(Number(event.target.value))} />
          <button type="button" aria-expanded={tray === 'cues'} onClick={() => { setOptionsOpen(false); setTray(tray === 'cues' ? null : 'cues'); }}>Cues</button>
          <button type="button" aria-expanded={tray === 'tools'} onClick={() => { setOptionsOpen(false); setTray(tray === 'tools' ? null : 'tools'); }}>Tools</button>
          <button ref={exitButton} type="button" onClick={closeStage}>Exit</button>
        </div>
        <div className="youtube-tools class-tempo-panel" hidden={stage && tray !== 'tools'}>{speedControls}</div>
        <section className="youtube-options" hidden={!optionsOpen} aria-label="YouTube options">
          <div className="youtube-options-heading"><h3>Video options</h3><button ref={optionsDone} type="button" onClick={closeOptions}>Done</button></div>
          <p>Your video stays open while you use these options. Talk quiets the audio while the video continues.</p>
          <details><summary>Playback &amp; source limits</summary><p>YouTube controls the available speeds, ads and video availability. Keep the app open; playback pauses when you hide the app or change sources. Practice, class plans, Stems, mirroring and offline playback use imported files.</p></details>
          <div className="youtube-options-links">{selected && <a href={selected.url} target="_blank" rel="noopener noreferrer">Open this video on YouTube ↗</a>}<a href={PRIVACY_PAGE} target="_blank" rel="noopener noreferrer">YouTube privacy ↗</a></div>
          <button type="button" onClick={() => showPicker()}>Choose another YouTube video</button>
        </section>
        <div className="youtube-cues-heading" hidden={stage || optionsOpen}><CueStemsSwitch value="cues" onChange={() => {}} stemsDisabled />
          {undo.length > 0 && <button type="button" disabled={!ready} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { changeCues(previous, false); setUndo(items => items.slice(0, -1)); } }}>Undo</button>}
          <button type="button" disabled={!ready} onClick={() => { player.current?.pause(); setEditing(true); }}>Edit cues</button>
        </div>
        <div className="youtube-cues" hidden={optionsOpen || stage && tray !== 'cues'}>{compactCues}</div>
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
