import { downmix } from '@mixdeck/analysis';
import { VideoDeck, type DancerPlayer, type Engine, type StretchDeck } from '@mixdeck/engine';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analysis } from '../analysisClient';
import nowPlayingLogo from '../assets/itda-logo-white.png';
import { Waveform, type WaveformMarker } from '../components/Waveform';
import { makeDemoTrack } from '../demo';
import { cueSection, lockScreenLine } from '../platform/cueLabel';
import { nextCueTime, previousCueTime } from '../platform/cueNavigation';
import { createKeepAlive } from '../platform/keepAlive';
import {
  clearMediaSession,
  refreshHandlers,
  setHandlers,
  setNowPlaying,
  setNowPlayingArtist,
  setPlaybackState,
  setPosition,
} from '../platform/mediaSession';
import { requestPersistentStorage } from '../platform/persist';
import { createWakeLock } from '../platform/wakeLock';
import { formatTime, type TrackState } from '../types';
import { CuePads, padColor } from './CuePads';
import { emptyCues, loadCues, saveCues, type CueSlots } from './cueStore';
import { dancerAudio } from './dancerAudio';
import { ACCEPT_MEDIA, countCues, isVideoFile } from './media';
import { StageView } from './StageView';
import { clampTempo, TempoControl } from './TempoControl';
import { VideoView } from './VideoView';
import './dancer.css';

interface Props {
  engine: Engine;
  /**
   * Dancer mode is the mode on screen. It stays mounted while DJ mode shows, so the song, cues and tempo survive a
   * switch; while inactive it is paused, off the lock screen and ignores the keyboard.
   */
  active: boolean;
  actionsContainer: HTMLDivElement | null;
}

/** The loaded song and its cues travel together so a cue save can never target the wrong track. */
interface Song {
  /** Load number: background analysis only ever updates the load that started it. */
  id: number;
  /** 'audio': decoded into the key-locked StretchDeck; 'video': played by the VideoDeck's `<video>` from the file. */
  kind: 'audio' | 'video';
  track: TrackState;
  cues: CueSlots;
  /** Width / height of a video's picture; null for audio, and for a video file without a picture. */
  aspect: number | null;
}

const NO_CUES: CueSlots = emptyCues();

/** Lock-screen scrubber refresh while playing, ms (the OS extrapolates in between). */
const POSITION_SYNC_MS = 5000;
/** How often the lock-screen cue line is checked while playing, ms (it is only written when the section changes). */
const SECTION_CHECK_MS = 250;
/** How long a status toast ("Cues restored", a load error) stays up, ms. */
const TOAST_MS = 3500;

/** Keys are ignored while typing; range sliders and buttons still get the shortcuts. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type);
  return false;
}

/** Second line of the lock-screen Now Playing card: where the playhead is among the cues (contract D). */
function sectionLine(cues: CueSlots, position: number): string {
  return lockScreenLine(cueSection(cues, position), countCues(cues) > 0);
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * Minimal single-song player: launchable cue pads and key-locked tempo, no EQ, no mixer. Audio files play on the
 * engine's StretchDeck, video files on a VideoDeck (shown in place of the waveform, and full screen in Stage view).
 */
export function DancerMode({ engine, active, actionsContainer }: Props) {
  const [stretch, setStretch] = useState<StretchDeck | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  /** The player the transport drives: the StretchDeck, or the VideoDeck while a video is loaded. */
  const [player, setPlayer] = useState<DancerPlayer | null>(null);
  const playerRef = useRef<DancerPlayer | null>(null);
  /** Created on the first video load, disposed on unmount. */
  const videoRef = useRef<VideoDeck | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoadingState] = useState(false);
  const loadingRef = useRef(false);
  const setLoading = (value: boolean) => {
    loadingRef.current = value;
    setLoadingState(value);
  };
  const [pendingVideo, setPendingVideo] = useState<HTMLVideoElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  /** percent */
  const [tempo, setTempo] = useState(100);
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const positionRef = useRef(0);
  const [displayPos, setDisplayPos] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const stageButton = useRef<HTMLButtonElement>(null);
  const nextLoadId = useRef(0);
  const nextToastId = useRef(0);
  /** The lock-screen second line as last written, so it is only rewritten when the cue section changes. */
  const artistLine = useRef<string | null>(null);
  // latest props / state for callbacks that outlive a render (player callbacks, Media Session handlers, timers)
  const activeRef = useRef(active);
  const songRef = useRef(song);
  useLayoutEffect(() => {
    activeRef.current = active;
    songRef.current = song;
  });

  // one of each per mount; nothing is built until first use. The keep-alive re-takes WebKit's "started last"
  // when the context starts after it, and re-registers the lock-screen handlers each time it really starts.
  const [keepAlive] = useState(() => {
    const keep = createKeepAlive({
      context: engine.ctx,
      onStarted: () => {
        // Native media keys can restart a loaded element after our Media Session handlers are cleared.
        const p = playerRef.current;
        if (activeRef.current && p?.kind === 'audio' && p.playing) refreshHandlers();
        else keep.stop();
      },
    });
    return keep;
  });
  const [screenOn, setScreenOn] = useState(false);
  // "Screen on" follows the lock the browser actually holds: a refused request, a failed re-acquire on return, or
  // a lock the system drops (battery saver / Low Power Mode) switches the toggle back off
  const [wakeLock] = useState(() => {
    const lock = createWakeLock({
      onChange: (held) => {
        setScreenOn(held);
        if (!held) void lock.disable();
      },
    });
    return lock;
  });

  const selectPlayer = (p: DancerPlayer) => {
    playerRef.current = p;
    setPlayer(p);
  };

  const showToast = (text: string) => setToast({ id: ++nextToastId.current, text });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // the engine's shared key-locked deck (its processor cannot be destroyed, so it is never recreated);
  // released on unmount, which also covers StrictMode's double mount
  useEffect(() => {
    const slot: { live: boolean; deck: StretchDeck | null } = { live: true, deck: null };
    engine.getStretchDeck().then(
      (d) => {
        if (!slot.live) return;
        slot.deck = d;
        setStretch(d);
        if (!playerRef.current) selectPlayer(d);
      },
      (e: unknown) => {
        if (slot.live) setDeckError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      slot.live = false;
      slot.deck?.release();
    };
  }, [engine]);

  // silent keep-alive, screen wake lock and the video player go with the component
  useEffect(
    () => () => {
      keepAlive.stop();
      keepAlive.dispose();
      void wakeLock.disable();
      videoRef.current?.dispose();
      videoRef.current = null;
    },
    [keepAlive, wakeLock],
  );

  // App's audio recovery reads whether the Web Audio player is playing and restarts our keep-alive after an
  // interruption; a video is its own media element and needs neither (the StretchDeck is empty and paused then)
  useEffect(() => {
    if (!stretch) return;
    dancerAudio.deck = stretch;
    dancerAudio.keepAlive = keepAlive;
    return () => {
      if (dancerAudio.deck !== stretch) return;
      dancerAudio.deck = null;
      dancerAudio.keepAlive = null;
    };
  }, [stretch, keepAlive]);

  /** Lock-screen cue line, rewritten only when the playhead has moved into another section. */
  const syncSection = useCallback(() => {
    const p = playerRef.current;
    const s = songRef.current;
    if (!activeRef.current || !p?.track || !s) return;
    // mid-load the player already has the new track while the song (and its cues) is still the previous one
    if (p.track.name !== s.track.name || p.track.duration !== s.track.duration) return;
    const line = sectionLine(s.cues, p.position);
    if (line === artistLine.current) return;
    artistLine.current = line;
    setNowPlayingArtist(line);
  }, []);

  /**
   * Lock-screen play/pause state and scrubber, from the player itself (always current, also mid-load); the audio
   * keep-alive's clock follows the song so WebKit reads the same position from it.
   */
  const syncMedia = useCallback(() => {
    const p = playerRef.current;
    const track = p?.track;
    if (!activeRef.current || !p || !track) return;
    if (setPlaybackState(p.playing ? 'playing' : 'paused')) keepAlive.claim();
    setPosition({ duration: track.duration, position: p.position, rate: p.tempo });
    if (p.kind === 'audio') keepAlive.sync(p.position, p.tempo);
    syncSection();
  }, [keepAlive, syncSection]);

  // player → ref (~every 50 ms); ref → text at 10 Hz; the waveform reads the ref via rAF. onPlayingChange keeps
  // the button true to the player, including pauses the OS makes (iOS pauses a video when the screen locks).
  useEffect(() => {
    if (!player) return;
    player.onPosition = (s) => {
      positionRef.current = s;
    };
    player.onPlayingChange = (isPlaying) => {
      if (isPlaying && !activeRef.current) {
        player.pause();
        return;
      }
      setPlaying(isPlaying);
      if (!isPlaying && player.kind === 'audio') keepAlive.stop();
      // WebKit ignores handlers registered before the page had a playing media element: register them again
      if (isPlaying && player.kind === 'video') refreshHandlers();
      syncMedia();
    };
    player.onEnded = syncMedia;
    return () => {
      player.onPosition = null;
      player.onPlayingChange = null;
      player.onEnded = null;
    };
  }, [player, keepAlive, syncMedia]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setDisplayPos(positionRef.current), 100);
    return () => clearInterval(t);
  }, [active]);

  // the OS extrapolates the scrubber at the tempo; re-anchor it now and then against drift
  useEffect(() => {
    if (!active || !playing) return;
    const t = setInterval(syncMedia, POSITION_SYNC_MS);
    return () => clearInterval(t);
  }, [active, playing, syncMedia]);

  // the lock-screen cue line follows the playhead (checked ≤ 4×/s, written only on a section change)
  useEffect(() => {
    if (!active || !playing) return;
    const t = setInterval(syncSection, SECTION_CHECK_MS);
    return () => clearInterval(t);
  }, [active, playing, syncSection]);

  // cues persist per track; a cue edit can change the lock-screen line
  useEffect(() => {
    if (!song) return;
    saveCues(song.track.name, song.track.duration, song.cues);
    syncSection();
  }, [song, syncSection]);

  // leaving the mode: silence it (the Media Session effect below clears the lock screen), close Stage, and let
  // the screen sleep again
  useEffect(() => {
    if (active) return;
    playerRef.current?.pause();
    keepAlive.stop();
    setStageOpen(false);
    setScreenOn(false);
    void wakeLock.disable();
  }, [active, keepAlive, wakeLock]);

  /** A freshly loaded song starts paused at 0:00, 100 %, out of edit mode. */
  const resetTransport = () => {
    positionRef.current = 0;
    setDisplayPos(0);
    setPlaying(false);
    setTempo(100);
    setEditing(false);
  };

  /** Shows that cues are kept per song: they come back whenever the same file is loaded again. */
  const announceCues = (cues: CueSlots) => {
    const n = countCues(cues);
    if (n > 0) showToast(`Cues restored · ${n} saved for this song`);
  };

  const loadBuffer = async (buffer: AudioBuffer, name: string) => {
    const deck = stretch;
    if (!deck) return;
    const id = ++nextLoadId.current;
    setLoading(true);
    setLoadError(null);
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const mono = downmix(channels);
    keepAlive.stop(); // loading pauses the deck
    const previous = playerRef.current;
    if (previous && previous !== deck) previous.unload(); // leaving a video: stop it and let go of its file
    selectPlayer(deck);
    try {
      await deck.load(buffer, name);
      if (!deck.track || id !== nextLoadId.current) return;
      deck.setTempo(1);
      resetTransport();
      const cues = loadCues(name, buffer.duration);
      setSong({
        id,
        kind: 'audio',
        track: { name, duration: buffer.duration, bpm: null, firstBeat: 0, peaks: null, analyzing: true },
        cues,
        aspect: null,
      });
      keepAlive.setTrack(buffer.duration); // a silent file as long as the song, built now, outside the tap that plays it
      announceCues(cues);
      syncMedia(); // the Now Playing effect below only re-runs when the song changes
    } catch (e) {
      // the deck dropped its buffers before failing, so the previous song is gone too: back to the empty state
      console.error(e);
      positionRef.current = 0;
      setDisplayPos(0);
      setPlaying(false);
      setSong(null);
      keepAlive.setTrack(null);
      showToast(`“${name}” could not be loaded.`);
      return;
    } finally {
      setLoading(false);
    }
    // analysis runs on after loading has finished; a failure just leaves the track un-analysed
    try {
      const r = await analysis.analyze(mono, buffer.sampleRate);
      setSong((s) =>
        s && s.id === id
          ? { ...s, track: { ...s.track, bpm: r.confidence > 1.5 ? r.bpm : null, firstBeat: r.firstBeat, peaks: r.peaks, analyzing: false } }
          : s,
      );
    } catch (e) {
      console.error(e);
      setSong((s) => (s && s.id === id ? { ...s, track: { ...s.track, analyzing: false } } : s));
    }
  };

  /**
   * Opens a video on the VideoDeck: played by the `<video>` element straight from the file (never decoded whole,
   * avoiding a second full-file decode competing with the native video decoder on phones). Video uses a seekable
   * timeline and percent tempo; waveform/BPM analysis is reserved for audio files.
   */
  const loadVideo = async (file: File) => {
    const id = ++nextLoadId.current;
    setLoading(true);
    keepAlive.stop();
    const previous = playerRef.current;
    previous?.pause();
    const video = (videoRef.current ??= new VideoDeck());
    setLoadError(null);
    // Mount before metadata resolves: WebKit may defer picture loading for a detached media element.
    setPendingVideo(video.element);
    try {
      await video.load(file, file.name);
    } catch (e) {
      console.error(e);
      const message = errorText(e, `“${file.name}” could not be opened.`);
      setLoadError(message);
      showToast(message);
      setPendingVideo(null);
      if (previous === video) {
        // the failed load replaced the previous video; a previous audio song is still loaded (paused)
        positionRef.current = 0;
        setDisplayPos(0);
        setPlaying(false);
        setSong(null);
      }
      setLoading(false);
      return;
    }
    setPendingVideo(null);
    const track = video.track;
    if (!track || id !== nextLoadId.current) {
      setLoading(false);
      return;
    }
    if (previous && previous !== video) previous.unload(); // the audio song: silence it and free its buffers
    video.setTempo(1);
    selectPlayer(video);
    keepAlive.setTrack(null); // never started for a video: the video element is the page's media element
    resetTransport();
    const { videoWidth, videoHeight } = video.element;
    const cues = loadCues(track.name, track.duration);
    setSong({
      id,
      kind: 'video',
      track: { name: track.name, duration: track.duration, bpm: null, firstBeat: 0, peaks: null, analyzing: false },
      cues,
      aspect: videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : null,
    });
    setLoading(false);
    announceCues(cues);
    syncMedia();
  };

  /** Loads one file: videos on the VideoDeck, audio decoded for the StretchDeck. Ignored while another load runs. */
  const loadFile = async (file: File) => {
    if (loadingRef.current) return;
    if (isVideoFile(file)) {
      await loadVideo(file);
      return;
    }
    if (!stretch) {
      showToast(deckError ? 'The key-locked player failed to start.' : 'The player is still starting — try again in a moment.');
      return;
    }
    setLoading(true);
    setLoadError(null);
    let buffer: AudioBuffer;
    try {
      buffer = await engine.decode(file);
    } catch (e) {
      console.error(e);
      setLoading(false);
      const message = `“${file.name}” could not be decoded. Try MP3, M4A or WAV.`;
      setLoadError(message);
      showToast(message);
      return;
    }
    await loadBuffer(buffer, file.name);
  };

  const loadDemo = () => {
    if (!loadingRef.current) void loadBuffer(makeDemoTrack(engine.ctx, 120), 'Demo 120 BPM');
  };

  const seek = (seconds: number) => {
    const p = playerRef.current;
    if (!p?.track) return;
    p.seek(seconds);
    positionRef.current = p.position;
    setDisplayPos(p.position);
    syncMedia();
  };

  /**
   * Everything that starts playback runs inside a tap, key press or lock-screen action. WebKit enables lock-screen
   * scrubbing only when the session that started playback last can seek, and moving the Media Session into
   * 'playing' starts a (non-seekable) session of its own, so 'playing' is set first, then the media element starts:
   * the video itself, or for audio the silent keep-alive (synchronously, it needs the gesture) plus a context
   * resume for an interruption that ended while paused.
   */
  const startPlayback = (run: (p: DancerPlayer) => void) => {
    const p = playerRef.current;
    if (!p?.track || !activeRef.current || loadingRef.current) return;
    if (setPlaybackState('playing')) keepAlive.claim();
    run(p);
    if (p.kind === 'audio') {
      if (p.playing) {
        void keepAlive.start();
        engine.unlock();
      } else {
        keepAlive.stop();
      }
    }
    setPlaying(p.playing);
    syncMedia(); // back to 'paused' if it did not start
  };

  const play = () => startPlayback((p) => p.play());

  const pause = () => {
    const p = playerRef.current;
    if (!p?.track) return;
    p.pause();
    keepAlive.stop();
    setPlaying(false);
    syncMedia();
  };

  const togglePlay = () => (playerRef.current?.playing ? pause() : play());

  const restart = () => seek(0);

  /** Jump to `seconds` and play: cue launch, and lock-screen / headphone previous and next. */
  const launch = (seconds: number) =>
    startPlayback((p) => {
      p.jumpTo(seconds);
      positionRef.current = p.position;
    });

  const cueTimes = (): (number | null)[] => song?.cues.map((c) => c?.time ?? null) ?? [];

  const previousCue = () => {
    const p = playerRef.current;
    if (p) launch(previousCueTime(cueTimes(), p.position));
  };

  const nextCue = () => {
    const p = playerRef.current;
    if (!p) return;
    const t = nextCueTime(cueTimes(), p.position);
    if (t !== null) launch(t);
  };

  const changeTempo = (percent: number) => {
    const p = playerRef.current;
    if (!p) return;
    const v = clampTempo(percent);
    p.setTempo(v / 100);
    setTempo(v);
    syncMedia();
  };

  /**
   * Launch a set pad; set an empty one; while editing, (re)set any pad to the current position. `launchOnly`
   * (Stage view) never sets or moves a cue.
   */
  const pressPad = (i: number, launchOnly = false) => {
    const p = playerRef.current;
    if (!p?.track || !song) return;
    const cue = song.cues[i] ?? null;
    if (!launchOnly && (editing || !cue)) {
      const time = p.position; // live, not the last ~50 ms report
      setSong((s) => s && { ...s, cues: s.cues.map((c, j) => (j === i ? { time, name: c?.name ?? `Cue ${i + 1}` } : c)) });
      void requestPersistentStorage(); // once per page load: keep saved cues from being evicted
      return;
    }
    if (cue) launch(cue.time);
  };

  const clearPad = (i: number) => setSong((s) => s && { ...s, cues: s.cues.map((c, j) => (j === i ? null : c)) });

  const renamePad = (i: number) => {
    const cue = song?.cues[i];
    if (!cue) return;
    const input = window.prompt(`Name for pad ${i + 1}`, cue.name);
    if (input === null) return;
    const name = input.trim() || cue.name;
    setSong((s) => s && { ...s, cues: s.cues.map((c, j) => (j === i && c ? { ...c, name } : c)) });
  };

  /** The toggle reflects the actual held lock; feedback explains both success and refusal. */
  const toggleScreenOn = () => {
    if (screenOn) {
      setScreenOn(false);
      void wakeLock.disable();
      showToast('Screen can dim and auto-lock again.');
      return;
    }
    void wakeLock.enable().then((held) => {
      showToast(held
        ? 'Screen on keeps the display awake while MixDeck is visible. Tap again to allow dimming and auto-lock.'
        : 'Screen on could not be enabled. Battery saver or your browser may prevent it.');
    });
  };

  const closeStage = () => {
    setStageOpen(false);
    stageButton.current?.focus({ preventScroll: true });
  };

  // keyboard and lock-screen controls: the latest handlers live in refs so the single listener and the
  // once-registered Media Session handlers never see a stale closure
  const keys = useRef({ pressPad, togglePlay, restart, changeTempo, tempo, stageOpen });
  const remote = useRef({ play, pause, seek, previousCue, nextCue });
  useEffect(() => {
    keys.current = { pressPad, togglePlay, restart, changeTempo, tempo, stageOpen };
    remote.current = { play, pause, seek, previousCue, nextCue };
  });

  // lock-screen and headphone controls for the loaded song while the mode is on screen; cleared when the song is
  // unloaded or replaced, when the mode is left, and on unmount
  const songId = song?.id ?? null;
  const trackName = song?.track.name ?? null;
  useEffect(() => {
    if (!active || !player || songId === null || trackName === null) return;
    const line = sectionLine(songRef.current?.cues ?? NO_CUES, player.position);
    artistLine.current = line;
    setNowPlaying({ title: trackName, artist: line });
    setHandlers({
      play: () => remote.current.play(),
      pause: () => remote.current.pause(),
      stop: () => {
        remote.current.pause();
        remote.current.seek(0);
      },
      previoustrack: () => remote.current.previousCue(),
      nexttrack: () => remote.current.nextCue(),
      // fastSeek (a scrub in progress) needs nothing different: a seek is a single change
      seekto: (details) => {
        if (details.seekTime !== undefined) remote.current.seek(details.seekTime);
      },
    });
    syncMedia();
    return () => {
      artistLine.current = null;
      clearMediaSession();
    };
  }, [active, player, songId, trackName, syncMedia]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('.resume-audio')) return;
      if (!activeRef.current || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const h = keys.current;
      if (e.key.length === 1 && e.key >= '1' && e.key <= '8') {
        if (!e.repeat) h.pressPad(Number(e.key) - 1, h.stageOpen);
      } else if (e.key === ' ') {
        if (!e.repeat) h.togglePlay();
      } else if (e.key === 'ArrowLeft' && !h.stageOpen) {
        h.changeTempo(h.tempo - 1);
      } else if (e.key === 'ArrowRight' && !h.stageOpen) {
        h.changeTempo(h.tempo + 1);
      } else if (e.key === 'Home') {
        if (!e.repeat) h.restart();
      } else {
        return;
      }
      e.preventDefault();
    };
    // a focused button would also "click" on Space keyup; swallow it so play/pause fires once
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('.resume-audio')) return;
      if (activeRef.current && e.key === ' ' && !isTyping(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const markers = useMemo<WaveformMarker[]>(
    () => (song ? song.cues.flatMap((c, i) => (c ? [{ time: c.time, color: padColor(i), label: String(i + 1) }] : [])) : []),
    [song],
  );

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (stageOpen || !active) return;
    const file = e.dataTransfer.files[0];
    if (file && !loading) void loadFile(file);
  };

  const track = song?.track ?? null;
  const bpm = track?.bpm ? track.bpm * (tempo / 100) : null;
  const ready = player !== null && song !== null && !loading;
  // Keep the element mounted even when WebKit reports dimensions after loadedmetadata.
  const videoElement = pendingVideo ?? (song?.kind === 'video' && player instanceof VideoDeck ? player.element : null);
  useEffect(() => {
    if (!videoElement) return;
    const updateAspect = () => {
      const { videoWidth: width, videoHeight: height } = videoElement;
      if (width <= 0 || height <= 0) return;
      setSong((s) => s?.kind === 'video' && s.aspect !== width / height ? { ...s, aspect: width / height } : s);
    };
    videoElement.addEventListener('resize', updateAspect);
    videoElement.addEventListener('loadeddata', updateAspect);
    updateAspect();
    return () => {
      videoElement.removeEventListener('resize', updateAspect);
      videoElement.removeEventListener('loadeddata', updateAspect);
    };
  }, [videoElement, song?.id]);
  const waveformProps = {
    active: active && !stageOpen,
    peaks: track?.peaks ?? null,
    duration: track?.duration ?? 0,
    bpm: track?.bpm ?? null,
    firstBeat: track?.firstBeat ?? 0,
    loop: null,
    positionRef,
    onSeek: seek,
    markers,
    scrub: true,
  };

  return (
    <section
      className={`dancer ${dragOver ? 'drag' : ''} ${videoElement ? 'has-video' : ''} ${editing ? 'editing' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (stageOpen || !active) return;
        if (!loading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {actionsContainer && createPortal(<div className="dancer-actions" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
        <button onClick={loadDemo} disabled={!stretch || loading} title="Synthesised test track">
          Demo
        </button>
        <button onClick={() => fileInput.current?.click()} disabled={loading} title="Open a song or a video">
          Load
        </button>
        {wakeLock.supported && (
          <button
            className={`screen-on ${screenOn ? 'on' : ''}`}
            onClick={toggleScreenOn}
            aria-pressed={screenOn}
            aria-label="Screen on"
            aria-describedby="screen-on-help"
            title={screenOn ? 'Screen stays on — tap to let it sleep again' : 'Keep the screen on (no dimming or auto-lock)'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span className="screen-on-label">Screen on</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT_MEDIA}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
        <span id="screen-on-help" className="sr-only">Prevents dimming and auto-lock while MixDeck is visible. Tap again to turn it off.</span>
      </div>, actionsContainer)}

      <div className="dancer-clock">
        <span className="elapsed">{formatTime(displayPos)}</span>
        <span className="total">/ {formatTime(track?.duration ?? 0)}</span>
        <span className="bpm">
          {bpm ? (
            <>
              <span className="big">{bpm.toFixed(1)}</span>
              <span className="unit">BPM</span>
            </>
          ) : track?.analyzing ? (
            <>
              <span className="big">…</span>
              <span className="unit">BPM</span>
            </>
          ) : song?.kind === 'video' ? (
            // Videos skip audio analysis to keep the native decoder free: show tempo instead of an unknown BPM.
            <>
              <span className="big">{tempo}%</span>
              <span className="unit">tempo</span>
            </>
          ) : (
            <>
              <span className="big">--</span>
              <span className="unit">BPM</span>
            </>
          )}
        </span>
      </div>

      <div className="dancer-media-panel">
        <div className="dancer-track-info">
          <span className="dancer-track-kicker" role="img" aria-label="Now Playing">
            <span aria-hidden="true">N</span><img className="now-playing-logo" src={nowPlayingLogo} alt="" aria-hidden="true" /><span aria-hidden="true">W PLAYING</span>
          </span>
          <div className="dancer-track-title" title={track?.name}>
            {loading ? 'Opening video or song…' : loadError ? loadError : track?.name ?? (deckError ? `Player failed to start: ${deckError}` : 'Load a song or video to begin')}
          </div>
        </div>
        {videoElement ? (
          <div className="dancer-media" style={{ ['--video-ar' as string]: String(song?.aspect ?? 16 / 9) }}>
            {/* Stage borrows this same media element, preserving playback and the iOS gesture. */}
            <VideoView element={stageOpen ? null : videoElement} playing={playing} onTap={ready ? togglePlay : undefined} className="dancer-video" />
            <Waveform {...waveformProps} className="strip" />
          </div>
        ) : (
          <Waveform {...waveformProps} />
        )}
      </div>

      <div className="dancer-transport">
        <button className={`play ${playing ? 'on' : ''}`} onClick={togglePlay} disabled={!ready} title="Space">
          {playing ? '❚❚  Pause' : '▶  Play'}
        </button>
        <button onClick={restart} disabled={!ready} title="Home">
          ⟲ Restart
        </button>
        <button
          ref={stageButton}
          className="stage-open"
          onClick={() => setStageOpen(true)}
          disabled={!ready}
          title="Stage: full screen with only play, restart and the cue pads"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
          </svg>
          Stage
        </button>
      </div>

      {/* one box only where a layout needs it (phone landscape with a video: tempo above the pads); elsewhere its
          children sit straight on the card's grid (display: contents) */}
      <div className="dancer-side">
        <TempoControl value={tempo} onChange={changeTempo} disabled={!ready} />

        <div className="cues">
          <div className="cues-head">
            <h2>Cues</h2>
            {editing ? (
              <span className="dim cues-hint">Press a pad to move it here · ✕ clears · ✎ renames</span>
            ) : (
              <span className="dim cues-hint">
                <span className="hint-long">Empty pad: set a cue here · set pad: launch it · saved per song</span>
                <span className="hint-short">Tap empty pad to set · tap set pad to launch</span>
              </span>
            )}
            <button className={`cues-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} disabled={!ready}>
              Edit cues
            </button>
          </div>
          <CuePads cues={song?.cues ?? NO_CUES} editing={editing} disabled={!ready} onPress={pressPad} onClear={clearPad} onRename={renamePad} />
        </div>
      </div>

      <p className="dancer-hint kbd-hint">
        <kbd>1</kbd>–<kbd>8</kbd> pads · <kbd>Space</kbd> play / pause · <kbd>←</kbd> <kbd>→</kbd> tempo ±1 % · <kbd>Home</kbd> restart
      </p>

      <div className="dancer-toast-region" role="status" aria-live="polite">
        {toast && (
          <span key={toast.id} className="dancer-toast">
            {toast.text}
          </span>
        )}
      </div>

      {stageOpen && song && (
        <StageView
          video={videoElement}
          aspect={song.aspect}
          title={song.track.name}
          playing={playing}
          position={displayPos}
          cues={song.cues}
          section={cueSection(song.cues, displayPos).current?.name ?? null}
          onTogglePlay={togglePlay}
          onRestart={restart}
          onLaunch={(i) => pressPad(i, true)}
          onClose={closeStage}
        />
      )}
    </section>
  );
}
