import { downmix } from '@mixdeck/analysis';
import { VideoDeck, type DancerPlayer, type DrumFocus, type Engine, type StemMix, type StretchDeck } from '@mixdeck/engine';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { analysis } from '../analysisClient';
import { NowPlayingLabel, PlayerTransport } from '../components/PlayerChrome';
import { Waveform, type WaveformMarker } from '../components/Waveform';
import { LibraryModal } from '../library/LibraryModal';
import { getMediaFile, listClasses, listMedia, markOpened, saveMedia, type ClassSet, type LibraryMedia } from '../library/store';
import { ClassControls, type ClassControlsProps } from '../classes/ClassControls';
import { findNextClassEntry, getClassEntryLabel, loadClassResume, preflightClassFiles, saveClassResume, type ClassResume } from '../classes/session';
import { createPracticeController, type PracticeController, type PracticeState } from '../practice/controller';
import { PracticePanel } from '../practice/PracticePanel';
import { defaultPracticeSettings, loadPracticeSettings, normalizePracticeSettings, savePracticeSettings, selectedPracticeSection, type PracticeSettings } from '../practice/settings';
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
import { VideoTools } from './VideoTools';
import { CueStemsSwitch, type CuePanel } from './CueStemsSwitch';
import { ALL_STEMS, StemsPanel } from '../stems/StemsPanel';
import { usePreparedStems } from '../stems/usePreparedStems';
import './dancer.css';
import './classroom.css';

interface Props {
  engine: Engine;
  /**
   * Dancer mode is the mode on screen. It stays mounted while DJ mode shows, so the song, cues and tempo survive a
   * switch; while inactive it is paused, off the lock screen and ignores the keyboard.
   */
  active: boolean;
  actionsContainer: HTMLDivElement | null;
  request?: LocalPlayerRequest;
}

/** A source switch can open a selected local file directly, or reopen the saved library. */
export interface LocalPlayerRequest {
  id: number;
  file?: File;
  library?: boolean;
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

interface LiveClass {
  plan: ClassSet;
  media: LibraryMedia[];
  entryId: string;
  autoNext: boolean;
  finished: boolean;
}

interface FileLoadOptions {
  inClass?: boolean;
  video?: { play?: boolean; startTime?: number; tempo?: number };
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
export function DancerMode({ engine, active, actionsContainer, request }: Props) {
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
  const [videoError, setVideoError] = useState<string | null>(null);
  const [failedVideoFile, setFailedVideoFileState] = useState<File | null>(null);
  const failedVideoFileRef = useRef<File | null>(null);
  const setFailedVideoFile = (file: File | null) => { failedVideoFileRef.current = file; setFailedVideoFileState(file); };
  const failedVideoLibraryId = useRef<string | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  /** percent */
  const [tempo, setTempo] = useState(100);
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [liveClass, setLiveClassState] = useState<LiveClass | null>(null);
  const liveClassRef = useRef<LiveClass | null>(null);
  const setLiveClass = (value: LiveClass | null) => { liveClassRef.current = value; setLiveClassState(value); };
  const [classBusy, setClassBusyState] = useState(false);
  const classBusyRef = useRef(false);
  const setClassBusy = (value: boolean) => { classBusyRef.current = value; setClassBusyState(value); };
  const [classDrawerOpen, setClassDrawerOpen] = useState(false);
  const [classStatus, setClassStatus] = useState('');
  const [resumeResult] = useState(loadClassResume);
  const [classResume, setClassResume] = useState<ClassResume | null>(resumeResult.resume);
  const classResumeRef = useRef(classResume);
  const [resumeName, setResumeName] = useState('your class');
  const classGeneration = useRef(0);
  const classPreflight = useRef<AbortController | null>(null);
  const classRun = useRef(0);
  const classStartPermit = useRef(0);
  const classArmed = useRef(false);
  const classCompleted = useRef<() => void>(() => {});
  const [nextFileBusy, setNextFileBusy] = useState(false);
  const nextClassFile = useRef<{ classId: string; entryId: string; file: File } | null>(null);
  const classSaveFailed = useRef(false);
  const loadedClassMedia = useRef<string | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const preparedStems = usePreparedStems(engine, currentFile, song?.id ?? null, song?.track.duration ?? 0);
  const [stemMix, setStemMix] = useState<StemMix>({ ...ALL_STEMS });
  const [drumFocus, setDrumFocus] = useState<DrumFocus>('full');
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practice, setPractice] = useState<PracticeSettings>(defaultPracticeSettings);
  const [practiceState, setPracticeState] = useState<PracticeState>({ phase: 'idle', pass: 0, remainingSeconds: 0 });
  const [talking, setTalking] = useState(false);
  const [undoCues, setUndoCues] = useState<CueSlots[]>([]);
  const practiceRef = useRef(practice);
  const practiceController = useRef<PracticeController | null>(null);
  const commands = useRef({ play: () => {}, pause: () => {}, seek: (_seconds: number) => {} });
  const videoStarted = useRef(false);
  const talkResume = useRef(false);
  const loadRequest = useRef(0);
  const modalOpen = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [cuePanel, setCuePanel] = useState<CuePanel>('cues');
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
    practiceRef.current = practice;
    modalOpen.current = libraryOpen || practiceOpen || classDrawerOpen;
  });

  // one of each per mount; nothing is built until first use. The keep-alive re-takes WebKit's "started last"
  // when the context starts after it, and re-registers the lock-screen handlers each time it really starts.
  const [keepAlive] = useState(() => {
    const keep = createKeepAlive({
      context: engine.ctx,
      onStarted: () => {
        // Native media keys can restart a loaded element after our Media Session handlers are cleared.
        const p = playerRef.current;
        const phase = practiceController.current?.getState().phase;
        if (activeRef.current && p?.kind === 'audio' && (p.playing || phase === 'delay' || phase === 'gap' || phase === 'preparing')) refreshHandlers();
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

  useEffect(() => {
    const controller = createPracticeController({
      transport: {
        play: () => commands.current.play(),
        pause: () => commands.current.pause(),
        seek: (seconds) => commands.current.seek(seconds),
      },
      onState: (state) => {
        setPracticeState(state);
        if (state.phase === 'complete') classCompleted.current();
      },
      onError: () => showToast('Playback could not resume. Tap Play to try again.'),
    });
    practiceController.current = controller;
    return () => { controller.dispose(); practiceController.current = null; };
  }, []);

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
    if (!player || player.kind !== 'audio') return;
    dancerAudio.deck = player;
    dancerAudio.keepAlive = keepAlive;
    return () => {
      if (dancerAudio.deck !== player) return;
      dancerAudio.deck = null;
      dancerAudio.keepAlive = null;
    };
  }, [player, keepAlive]);

  /** Lock-screen cue line, rewritten only when the playhead has moved into another section. */
  const syncSection = useCallback(() => {
    const p = playerRef.current;
    const s = songRef.current;
    if (!activeRef.current || !p?.track || !s) return;
    // mid-load the player already has the new track while the song (and its cues) is still the previous one
    if (p.track.name !== s.track.name || Math.abs(p.track.duration - s.track.duration) > 0.002) return;
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
    const video = player instanceof VideoDeck ? player.element : null;
    const rememberVideo = () => { videoStarted.current = true; };
    const syncVideoError = () => {
      const error = player instanceof VideoDeck ? player.error : null;
      setVideoError(error);
      if (error) {
        classRun.current++; classStartPermit.current++; classArmed.current = false;
        practiceController.current?.cancel();
        keepAlive.stop();
        setPlaying(false);
        setTalking(false);
        talkResume.current = false;
        syncMedia();
      }
    };
    video?.addEventListener('playing', rememberVideo);
    video?.addEventListener('error', syncVideoError);
    video?.addEventListener('loadstart', syncVideoError);
    syncVideoError();
    player.onPosition = (s) => {
      positionRef.current = s;
      practiceController.current?.tick(s);
    };
    player.onPlayingChange = (isPlaying) => {
      if (isPlaying && !activeRef.current) {
        player.pause();
        return;
      }
      setPlaying(isPlaying);
      if (isPlaying && liveClassRef.current && !classBusyRef.current) classArmed.current = true;
      const phase = practiceController.current?.getState().phase;
      if (!isPlaying && phase === 'playing' && player.position < (player.track?.duration ?? 0) - 0.03) {
        practiceController.current?.cancel(); // OS interruption or a refused delayed native play
      }
      const atEnd = player.position >= (player.track?.duration ?? Infinity) - 0.03;
      if (!isPlaying && player.kind === 'audio' && phase !== 'gap' && phase !== 'delay' && !(atEnd && phase === 'playing')) keepAlive.stop();
      // WebKit ignores handlers registered before the page had a playing media element: register them again
      if (isPlaying && player.kind === 'video') refreshHandlers();
      syncMedia();
    };
    player.onEnded = () => {
      if (player.playing) return; // onPosition may already have restarted a repeat at the file boundary.
      practiceController.current?.tick(player.track?.duration ?? 0);
      const phase = practiceController.current?.getState().phase;
      if (!player.playing && phase === 'playing') practiceController.current?.cancel();
      if (!player.playing && phase !== 'gap') keepAlive.stop();
      if (practiceRef.current.mode === 'off') classCompleted.current();
      syncMedia();
    };
    return () => {
      video?.removeEventListener('playing', rememberVideo);
      video?.removeEventListener('error', syncVideoError);
      video?.removeEventListener('loadstart', syncVideoError);
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
    if (!saveCues(song.track.name, song.track.duration, song.cues)) showToast('Cues could not be saved on this device.');
    syncSection();
  }, [song, syncSection]);

  // leaving the mode: silence it (the Media Session effect below clears the lock screen), close Stage, and let
  // the screen sleep again
  useEffect(() => {
    if (active) return;
    if (preparedStems.state.phase === 'working') preparedStems.cancel();
    practiceController.current?.cancel();
    classRun.current++; classStartPermit.current++; classGeneration.current++;
    classArmed.current = false;
    classPreflight.current?.abort();
    setClassBusy(false);
    playerRef.current?.pause();
    videoRef.current?.pause(); // Also revoke a class video's pending first-play intent before selection.
    keepAlive.stop();
    setStageOpen(false);
    setLibraryOpen(false);
    setPracticeOpen(false);
    setClassDrawerOpen(false);
    setEditing(false);
    setScreenOn(false);
    void wakeLock.disable();
  }, [active, keepAlive, wakeLock]);

  /** A freshly loaded song starts paused at 0:00, 100 %, out of edit mode. */
  const resetTransport = (name: string, duration: number) => {
    practiceController.current?.cancel();
    setVideoError(playerRef.current instanceof VideoDeck ? playerRef.current.error : null);
    const saved = loadPracticeSettings(name, duration);
    practiceRef.current = saved;
    setPractice(saved);
    playerRef.current?.setTempo(saved.tempo);
    positionRef.current = 0;
    setDisplayPos(0);
    setPlaying(false);
    setTempo(Math.round(saved.tempo * 100));
    setEditing(false);
    setUndoCues([]);
    setStemMix({ ...ALL_STEMS });
    setDrumFocus('full');
    setTalking(false);
    talkResume.current = false;
    engine.setDancerGain(1);
    videoStarted.current = false;
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
      resetTransport(name, buffer.duration);
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
      if (id !== nextLoadId.current) return false;
      // the deck dropped its buffers before failing, so the previous song is gone too: back to the empty state
      console.error(e);
      positionRef.current = 0;
      setDisplayPos(0);
      setPlaying(false);
      setSong(null);
      keepAlive.setTrack(null);
      showToast(`“${name}” could not be loaded.`);
      return false;
    } finally {
      if (id === nextLoadId.current) setLoading(false);
    }
    // analysis runs on after loading has finished; a failure just leaves the track un-analysed
    void (async () => { try {
      const r = await analysis.analyze(mono, buffer.sampleRate);
      setSong((s) =>
        s && s.id === id
          ? { ...s, track: { ...s.track, bpm: r.confidence > 1.5 ? r.bpm : null, firstBeat: r.firstBeat, peaks: r.peaks, analyzing: false } }
          : s,
      );
    } catch (e) {
      console.error(e);
      setSong((s) => (s && s.id === id ? { ...s, track: { ...s.track, analyzing: false } } : s));
    } })();
    return true;
  };

  /**
   * Opens a video on the VideoDeck: played by the `<video>` element straight from the file (never decoded whole,
   * avoiding a second full-file decode competing with the native video decoder on phones). Video uses a seekable
   * timeline and percent tempo; waveform/BPM analysis is reserved for audio files.
   */
  const loadVideo = async (file: File, options?: FileLoadOptions['video']) => {
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
      await video.load(file, file.name, options);
    } catch (e) {
      if (id !== nextLoadId.current) return false;
      console.error(e);
      const message = errorText(e, `“${file.name}” could not be opened.`);
      setLoadError(message);
      setFailedVideoFile(file);
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
      return false;
    }
    if (id !== nextLoadId.current) return false;
    setPendingVideo(null);
    const track = video.track;
    if (!track || id !== nextLoadId.current) {
      setLoading(false);
      return false;
    }
    if (previous && previous !== video) previous.unload(); // the audio song: silence it and free its buffers
    if (stretch && previous !== stretch) stretch.unload();
    selectPlayer(video);
    keepAlive.setTrack(null); // never started for a video: the video element is the page's media element
    resetTransport(track.name, track.duration);
    if (options) {
      video.setTempo(options.tempo ?? 1);
      positionRef.current = video.position;
      setDisplayPos(video.position);
      setPlaying(video.playing);
      videoStarted.current = video.playing;
    }
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
    return true;
  };

  /** Loads one file: videos on the VideoDeck, audio decoded for the StretchDeck. Ignored while another load runs. */
  const loadFile = async (file: File, libraryId?: string | null, options: FileLoadOptions = {}): Promise<boolean> => {
    if (loadingRef.current) return false;
    if (!options.inClass) {
      if (liveClassRef.current) leaveClass(false);
      else { classGeneration.current++; classPreflight.current?.abort(); setClassBusy(false); }
      classStartPermit.current++;
    }
    classRun.current++;
    classArmed.current = false;
    loadedClassMedia.current = null;
    setFailedVideoFile(null);
    const request = ++loadRequest.current;
    practiceController.current?.cancel();
    pauseNow();
    // Return to the still-loaded original before releasing the stem worklet. A failed replacement
    // file must leave the previous song usable, and stale preparation must never take over later.
    if (playerRef.current === preparedStems.deck.current && stretch?.track) switchAudioPlayer(stretch);
    preparedStems.reset();
    setStemMix({ ...ALL_STEMS });
    setDrumFocus('full');
    setTalking(false);
    talkResume.current = false;
    engine.setDancerGain(1);
    let loaded = false;
    if (isVideoFile(file)) {
      failedVideoLibraryId.current = libraryId;
      loaded = await loadVideo(file, options.video);
    } else if (!stretch) {
      showToast(deckError ? 'The key-locked player failed to start.' : 'The player is still starting — try again in a moment.');
      return false;
    } else {
      setLoading(true);
      setLoadError(null);
      let buffer: AudioBuffer;
      try {
        buffer = await engine.decode(file);
      } catch (e) {
        if (request !== loadRequest.current) return false;
        console.error(e);
        setLoading(false);
        const message = `“${file.name}” could not be decoded. Try MP3, M4A or WAV.`;
        setLoadError(message);
        showToast(message);
        return false;
      }
      if (request !== loadRequest.current) return false;
      loaded = (await loadBuffer(buffer, file.name)) === true;
    }
    if (!loaded || request !== loadRequest.current) return false;
    setCurrentFile(file);
    // Keep video loading native; saving the Blob never decodes a second copy for analysis.
    if (libraryId !== null) void (async () => {
      try {
        const id = libraryId ?? (await saveMedia(file)).id;
        // Saving and updating recency are separate: a recency failure does not lose the saved file.
        await markOpened(id).catch(() => {});
      } catch {
        if (request === loadRequest.current) showToast('File opened. It could not be saved for offline use.');
      }
    })();
    return true;
  };

  const seek = (seconds: number) => {
    if (failedVideoFile) return;
    classStartPermit.current++;
    if (classBusyRef.current) videoRef.current?.pause();
    practiceController.current?.cancel();
    talkResume.current = false;
    const p = playerRef.current;
    if (!p?.track || (p instanceof VideoDeck && p.error)) return;
    const wasPlaying = p.playing;
    classRun.current++;
    classArmed.current = wasPlaying;
    // A delay or repeat gap has a running keep-alive but an already-paused player.
    // Its seek emits no pause event, so cancel the silent media session explicitly.
    if (!wasPlaying) keepAlive.stop();
    p.seek(seconds);
    positionRef.current = p.position;
    setDisplayPos(p.position);
    const settings = practiceRef.current;
    const section = selectedPracticeSection(settings);
    if (settings.mode !== 'off' && section) {
      if (seconds < section.start || seconds >= section.end) {
        updatePractice({ ...settings, mode: 'off' }, false);
        showToast('Outside the practice range. Full track is now on. Choose Practice to repeat again.');
      }
      else if (wasPlaying) practiceController.current?.start({ settings: { ...settings, delaySeconds: 0 }, duration: p.track.duration, position: p.position });
    }
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
    if (!p?.track || !activeRef.current || loadingRef.current || classBusyRef.current || failedVideoFileRef.current || (p instanceof VideoDeck && p.error)) return;
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

  const playNow = () => startPlayback((p) => p.play());

  const pauseNow = () => {
    const p = playerRef.current;
    if (!p?.track) return;
    p.pause();
    if (practiceController.current?.getState().phase !== 'gap') keepAlive.stop();
    setPlaying(false);
    syncMedia();
  };

  useLayoutEffect(() => {
    commands.current = {
      play: playNow,
      pause: pauseNow,
      seek: (seconds) => { playerRef.current?.seek(seconds); positionRef.current = seconds; syncMedia(); },
    };
  });

  const play = () => {
    const p = playerRef.current;
    if (!p?.track || loadingRef.current || classBusyRef.current || failedVideoFile || p.playing || (p instanceof VideoDeck && p.error)) return;
    if (['delay', 'gap', 'preparing'].includes(practiceController.current?.getState().phase ?? '')) return;
    classRun.current++;
    classArmed.current = true;
    if (liveClassRef.current) {
      setLiveClass({ ...liveClassRef.current, finished: false });
      setClassStatus(liveClassRef.current.autoNext ? 'Auto-next on' : 'Next & play when you are ready');
    }
    if (p.kind === 'video' && talking) { setTalking(false); talkResume.current = false; }
    let settings = practiceRef.current;
    if (p.kind === 'video' && !videoStarted.current && settings.delaySeconds > 0) {
      settings = { ...settings, delaySeconds: 0 };
      showToast('Video starts immediately once to enable sound. Your delay applies from the next play.');
    }
    practiceController.current?.start({ settings, duration: p.track.duration, position: p.position, prepare: () => {
      engine.unlock();
      if (p.kind === 'audio') { setPlaybackState('playing'); void keepAlive.start(); }
    } });
  };

  const pause = () => {
    classStartPermit.current++;
    if (classBusyRef.current) videoRef.current?.pause();
    classRun.current++;
    classArmed.current = false;
    talkResume.current = false;
    practiceController.current?.cancel();
    pauseNow();
    rememberClass();
  };
  const waiting = ['preparing', 'delay', 'gap'].includes(practiceState.phase);
  const togglePlay = () => (playerRef.current?.playing || waiting ? pause() : play());

  /** Switch sources at the current position; all normal cues/practice/lock-screen commands stay shared. */
  const switchAudioPlayer = (next: DancerPlayer): void => {
    const previous = playerRef.current;
    if (!next.track || next === previous || loadingRef.current) return;
    const position = previous?.position ?? 0;
    const rate = previous?.tempo ?? 1;
    const wasPlaying = previous?.playing ?? false;
    const pending = ['preparing', 'delay', 'gap'].includes(practiceController.current?.getState().phase ?? '');
    // Source selection is not a new practice run. Silence the outgoing callbacks before pausing
    // so it cannot cancel the current pass; the controller's commands already use playerRef.
    if (previous) {
      previous.onPosition = null;
      previous.onPlayingChange = null;
      previous.onEnded = null;
    }
    previous?.pause();
    next.setTempo(rate);
    next.seek(position);
    selectPlayer(next);
    dancerAudio.deck = next;
    positionRef.current = next.position;
    setDisplayPos(next.position);
    setPlaying(false);
    if (wasPlaying) {
      startPlayback((p) => p.play());
    } else if (!pending) keepAlive.stop();
    syncMedia();
  };

  const useStems = (): void => {
    const next = preparedStems.deck.current;
    if (next && preparedStems.state.phase === 'ready') switchAudioPlayer(next);
  };
  const changeStemMix = (value: StemMix): void => {
    preparedStems.deck.current?.setMix(value);
    setStemMix(value);
    useStems();
  };
  const changeDrumFocus = (value: DrumFocus): void => {
    const next = preparedStems.deck.current;
    next?.setDrumFocus(value);
    const mix = { ...stemMix, drums: 1 };
    next?.setMix(mix);
    setDrumFocus(value);
    setStemMix(mix);
    useStems();
  };

  const restart = () => {
    const live = liveClassRef.current;
    const p = playerRef.current;
    if (!live) { seek(practiceRef.current.mode !== 'off' ? selectedPracticeSection(practiceRef.current)?.start ?? 0 : 0); return; }
    if (!p?.track || classBusyRef.current || loadingRef.current || (p instanceof VideoDeck && p.error)) return;
    const entry = live.plan.entries.find((item) => item.id === live.entryId);
    if (!entry) return;
    pause();
    const settings = normalizePracticeSettings(entry.practice ?? defaultPracticeSettings(), p.track.duration);
    settings.tempo = p.tempo;
    settings.delaySeconds = 0;
    practiceRef.current = settings; setPractice(settings);
    p.seek(settings.mode !== 'off' ? selectedPracticeSection(settings)?.start ?? 0 : 0);
    positionRef.current = p.position; setDisplayPos(p.position);
    play();
  };

  /** Cues and lock-screen / headphone navigation preserve the current playback state. */
  const goToCue = (seconds: number) => {
    if (failedVideoFile || classBusyRef.current || loadingRef.current) return;
    if (playerRef.current?.kind === 'video' && talking) setTalking(false);
    // The normal seek path cancels pending delays/gaps and class transitions, keeps
    // a playing practice inside its range, and never starts a paused player.
    seek(seconds);
  };

  const cueTimes = (): (number | null)[] => song?.cues.map((c) => c?.time ?? null) ?? [];

  const previousCue = () => {
    if (failedVideoFile) return;
    const p = playerRef.current;
    if (p instanceof VideoDeck && p.error) return;
    const selected = selectedPracticeSection(practiceRef.current);
    if (selected && p?.track && practiceRef.current.mode !== 'off') goToCue(selected.start);
    else if (p) goToCue(previousCueTime(cueTimes(), p.position));
  };

  const nextCue = () => {
    const p = playerRef.current;
    if (!p) return;
    const t = nextCueTime(cueTimes(), p.position);
    if (t !== null) goToCue(t);
  };

  const changeTempo = (percent: number) => {
    const p = playerRef.current;
    if (!p || failedVideoFile || (p instanceof VideoDeck && p.error)) return;
    const v = clampTempo(percent);
    p.setTempo(v / 100);
    setTempo(v);
    updatePractice({ ...practiceRef.current, tempo: v / 100 }, false);
    syncMedia();
  };

  const updatePractice = (value: PracticeSettings, cancel = true, persist = !liveClassRef.current) => {
    const s = songRef.current;
    if (!s) return;
    if (cancel) { classRun.current++; classStartPermit.current++; classArmed.current = false; practiceController.current?.cancel(); pauseNow(); }
    const next = normalizePracticeSettings(value, s.track.duration);
    practiceRef.current = next;
    setPractice(next);
    playerRef.current?.setTempo(next.tempo);
    setTempo(Math.round(next.tempo * 100));
    const saved = !persist || savePracticeSettings(s.track.name, s.track.duration, next);
    if (!saved) showToast('Practice settings could not be saved on this device.');
    return saved;
  };

  /** Leave rehearsal explicitly: cancel every pending pass, keep the position and saved presets. */
  const endPractice = () => {
    pause();
    setTalking(false);
    engine.setDancerGain(1);
    const saved = updatePractice({ ...practiceRef.current, mode: 'off', delaySeconds: 0 }, false);
    setPracticeOpen(false);
    if (saved) showToast('Practice ended. Tap Play for the full track. Your saved practices are kept.');
  };

  const savePractice = (value: PracticeSettings) => {
    if (updatePractice(value, true, true)) {
      const selected = selectedPracticeSection(value);
      showToast(selected ? `Saved “${selected.name}” for this track.` : 'Saved practice changes.');
    }
  };

  /** Commit the panel's visible range and start at A within this same user gesture. */
  const startPractice = (value: PracticeSettings) => {
    updatePractice(value, true, true);
    const p = playerRef.current;
    if (!p?.track || (p instanceof VideoDeck && p.error)) return;
    const section = value.mode !== 'off' ? selectedPracticeSection(value) : null;
    if (section) p.seek(section.start);
    positionRef.current = p.position;
    setDisplayPos(p.position);
    setPracticeOpen(false);
    play();
  };

  const rememberClass = () => {
    const live = liveClassRef.current;
    if (!live || classBusyRef.current) return;
    const value: ClassResume = { classId: live.plan.id, entryId: live.entryId,
      position: playerRef.current?.position ?? 0, autoNext: live.autoNext, finished: live.finished };
    const result = saveClassResume(value);
    classResumeRef.current = value; setClassResume(value); setResumeName(live.plan.name);
    if (!result.saved && !classSaveFailed.current) {
      classSaveFailed.current = true;
      showToast(result.error ?? 'Class progress could not be saved on this device.');
    }
  };

  const leaveClass = (finished: boolean) => {
    const live = liveClassRef.current;
    if (live && finished) setLiveClass({ ...live, finished: true });
    rememberClass();
    classGeneration.current++; classRun.current++; classStartPermit.current++; classArmed.current = false;
    classPreflight.current?.abort();
    practiceController.current?.cancel(); pauseNow();
    videoRef.current?.pause(); // Also invalidate a native play pending during metadata loading.
    if (loadingRef.current) {
      loadRequest.current++; nextLoadId.current++;
      playerRef.current?.unload(); videoRef.current?.unload();
      setSong(null); songRef.current = null; setCurrentFile(null); setPendingVideo(null);
      setLoading(false); setLoadError(null); setFailedVideoFile(null);
      keepAlive.setTrack(null);
    }
    setLiveClass(null); setClassBusy(false); setClassDrawerOpen(false); setClassStatus('');
    nextClassFile.current = null; setNextFileBusy(false); loadedClassMedia.current = null;
    const settings = { ...practiceRef.current, mode: 'off' as const, delaySeconds: 0 };
    practiceRef.current = settings; setPractice(settings);
    if (!classSaveFailed.current) showToast(finished ? 'Class finished.' : 'Class exited.');
  };

  /** Files are prefetched, not decoded: one player and one native video element remain in use. */
  const activateClassEntry = async (live: LiveClass, entryId: string, shouldPlay: boolean, resumePosition?: number): Promise<void> => {
    const entry = live.plan.entries.find((item) => item.id === entryId);
    if (!entry) throw new Error('This exercise is no longer in the class. Edit the class to choose another.');
    const generation = classGeneration.current;
    const permit = classStartPermit.current;
    rememberClass();
    setClassBusy(true); classRun.current++; classArmed.current = false;
    practiceController.current?.cancel(); pauseNow();
    if (shouldPlay) { engine.unlock(); void keepAlive.start(); }
    setClassStatus('Opening exercise…');
    try {
      const sameFile = loadedClassMedia.current === entry.mediaId && !!playerRef.current?.track
        && !failedVideoFileRef.current && !(playerRef.current instanceof VideoDeck && playerRef.current.error);
      if (!sameFile) {
        const prefetched = nextClassFile.current;
        const file = prefetched?.classId === live.plan.id && prefetched.entryId === entryId
          ? prefetched.file : await getMediaFile(entry.mediaId);
        if (generation !== classGeneration.current) return;
        // With a prefetched video this call reaches native play before the first await in this gesture.
        const requested = entry.practice ?? defaultPracticeSettings();
        const startTime = resumePosition ?? (requested.mode !== 'off' ? selectedPracticeSection(requested)?.start ?? 0 : 0);
        const loaded = await loadFile(file, entry.mediaId, { inClass: true,
          video: { play: shouldPlay && permit === classStartPermit.current && requested.delaySeconds === 0, startTime, tempo: requested.tempo } });
        if (generation !== classGeneration.current) return;
        if (!loaded) throw new Error('This exercise could not be opened. Retry it from the running order or open another file.');
      }
      const p = playerRef.current;
      if (!p?.track) throw new Error('The exercise could not be loaded.');
      if (p instanceof VideoDeck && p.error) throw new Error('Video could not play. Retry it or choose another exercise.');
      shouldPlay = shouldPlay && permit === classStartPermit.current;
      loadedClassMedia.current = entry.mediaId;
      const settings = normalizePracticeSettings(entry.practice ?? defaultPracticeSettings(), p.track.duration);
      const start = settings.mode !== 'off' ? selectedPracticeSection(settings)?.start ?? 0 : 0;
      const position = Math.max(0, Math.min(p.track.duration, resumePosition ?? start));
      practiceRef.current = settings; setPractice(settings); p.setTempo(settings.tempo);
      setTempo(Math.round(settings.tempo * 100));
      // Do not reset a native video that already began within the initiating tap.
      if (!p.playing || Math.abs(p.position - position) > 0.5) p.seek(position);
      positionRef.current = p.position; setDisplayPos(p.position);
      setTalking(false); talkResume.current = false; engine.setDancerGain(1);
      setLiveClass({ ...live, entryId, finished: false }); setClassBusy(false);
      setClassStatus(shouldPlay ? (live.autoNext ? 'Auto-next on' : 'Next when ready') : 'Ready · tap Play');
      if (shouldPlay) {
        classArmed.current = true;
        const firstVideo = p.kind === 'video' && !videoStarted.current;
        const playback = firstVideo ? { ...settings, delaySeconds: 0 } : settings;
        if (firstVideo && settings.delaySeconds > 0) showToast('Tap Play if needed to enable video sound. Delay applies after its first start.');
        practiceController.current?.start({ settings: playback, duration: p.track.duration, position: p.position,
          prepare: () => { engine.unlock(); if (p.kind === 'audio') void keepAlive.start(); } });
        if (p.kind === 'video' && !p.playing) setClassStatus('Ready · tap Play if video is paused');
      } else { p.pause(); setPlaying(false); }
      rememberClass(); syncMedia();
    } catch (error) {
      if (generation === classGeneration.current) {
        classArmed.current = false; pauseNow(); setClassBusy(false);
        setClassStatus(errorText(error, 'Exercise unavailable. Open the running order to retry.'));
      }
      throw error;
    } finally {
      if (generation === classGeneration.current) setClassBusy(false);
    }
  };

  const teachClass = async (plan: ClassSet, entryId?: string, resume?: ClassResume) => {
    if (classBusyRef.current || loadingRef.current) throw new Error('Wait for the current file to finish opening.');
    pause();
    const generation = ++classGeneration.current;
    classPreflight.current?.abort();
    const abort = new AbortController(); classPreflight.current = abort;
    setClassBusy(true);
    try {
      const media = await listMedia();
      const check = await preflightClassFiles(plan, media, { signal: abort.signal });
      if (!check.ready) throw new Error(check.missing.length
        ? `Import these files again before teaching: ${check.missing.map((item) => item.label).join(', ')}.`
        : 'Add at least one exercise before teaching this class.');
      if (generation !== classGeneration.current) return;
      const chosen = entryId ?? plan.entries[0]!.id;
      await activateClassEntry({ plan, media, entryId: chosen, autoNext: resume?.autoNext ?? plan.autoNext ?? false, finished: false }, chosen, false, resume?.position);
      if (generation === classGeneration.current) { setLibraryOpen(false); setClassDrawerOpen(false); }
    } finally { if (generation === classGeneration.current) setClassBusy(false); }
  };

  const chooseClassEntry = (entryId: string, shouldPlay: boolean) => {
    const live = liveClassRef.current;
    if (!live || classBusyRef.current || loadingRef.current) return;
    void activateClassEntry(live, entryId, shouldPlay).catch((error: unknown) => showToast(errorText(error, 'Exercise could not open.')));
  };

  const nextClassEntry = () => {
    const live = liveClassRef.current;
    if (!live || classBusyRef.current) return;
    const next = findNextClassEntry(live.plan.entries, live.entryId);
    if (next) chooseClassEntry(next.id, true);
    else leaveClass(true);
  };

  const resumeClass = async () => {
    const saved = classResumeRef.current;
    if (!saved || saved.finished) return;
    const generation = classGeneration.current;
    try {
      const plan = (await listClasses()).find((item) => item.id === saved.classId);
      if (generation !== classGeneration.current) return;
      if (!plan) throw new Error('This saved class was removed. Choose a class in Library.');
      await teachClass(plan, saved.entryId, saved);
    } catch (error) { showToast(errorText(error, 'Class could not resume.')); }
  };

  // Completion is deferred until the practice controller has parked at B and finished its pause/seek.
  useLayoutEffect(() => {
    classCompleted.current = () => {
      const live = liveClassRef.current;
      if (!live || !classArmed.current || classBusyRef.current) return;
      classArmed.current = false;
      const run = classRun.current; const generation = classGeneration.current;
      queueMicrotask(() => {
        if (run !== classRun.current || generation !== classGeneration.current || liveClassRef.current?.entryId !== live.entryId) return;
        const next = findNextClassEntry(live.plan.entries, live.entryId);
        if (!next) { setLiveClass({ ...live, finished: true }); setClassStatus('Class complete'); rememberClass(); }
        else if (live.autoNext) chooseClassEntry(next.id, true);
        else { setClassStatus('Complete · Next when ready'); rememberClass(); }
      });
    };
  });

  useEffect(() => {
    if (!classResume) return;
    let cancelled = false;
    void listClasses().then((plans) => {
      if (!cancelled) setResumeName(plans.find((item) => item.id === classResume.classId)?.name ?? 'your class');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [classResume?.classId]);

  useEffect(() => {
    if (!liveClass || classBusy) return;
    const next = findNextClassEntry(liveClass.plan.entries, liveClass.entryId);
    nextClassFile.current = null;
    if (!next) { setNextFileBusy(false); return; }
    let cancelled = false; setNextFileBusy(true);
    void getMediaFile(next.mediaId).then((file) => {
      if (!cancelled) nextClassFile.current = { classId: liveClass.plan.id, entryId: next.id, file };
    }).catch(() => {
      if (!cancelled) setClassStatus('Next file unavailable · open running order to retry');
    }).finally(() => { if (!cancelled) setNextFileBusy(false); });
    return () => { cancelled = true; };
  }, [liveClass?.plan.id, liveClass?.entryId, classBusy]);

  const persistClass = useRef(rememberClass);
  useLayoutEffect(() => { persistClass.current = rememberClass; });
  useEffect(() => {
    const save = () => persistClass.current();
    const timer = window.setInterval(save, 2000);
    window.addEventListener('pagehide', save); document.addEventListener('visibilitychange', save);
    return () => { save(); clearInterval(timer); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save);
      classGeneration.current++; classPreflight.current?.abort(); };
  }, []);

  const retryVideo = () => {
    const file = failedVideoFile ?? currentFile;
    if (!file || !isVideoFile(file) || loadingRef.current) return;
    setStageOpen(false);
    // A first Open that failed before metadata still needs its original save attempt after recovery.
    // Already loaded files and previously failed saves must not be written a second time.
    void loadFile(file, failedVideoFile ? failedVideoLibraryId.current : null);
  };

  const copyVideoDetails = () => {
    const video = videoRef.current;
    if (!video) return;
    const details = JSON.stringify({ app: 'ClassTempo', browser: navigator.userAgent, video: video.getDiagnostics() }, null, 2);
    const manualCopy = () => { window.prompt('Copy these video details and send them with your bug report:', details); };
    if (!navigator.clipboard?.writeText) { manualCopy(); return; }
    void navigator.clipboard.writeText(details).then(() => showToast('Video details copied. Include them when reporting this problem.'), manualCopy);
  };

  const toggleTalk = () => {
    const p = playerRef.current;
    if (!p?.track || failedVideoFile || (p instanceof VideoDeck && p.error)) return;
    if (!talking) {
      talkResume.current = p.playing;
      if (p.kind === 'video') { practiceController.current?.cancel(); pauseNow(); }
      else engine.setDancerGain(0.2);
      setTalking(true);
      showToast(p.kind === 'video' ? 'Video paused while you talk. Tap Finish talking to resume.' : 'Music lowered to 20%. Tap Finish talking to restore it.');
    } else {
      engine.setDancerGain(1);
      setTalking(false);
      if (p.kind === 'video' && talkResume.current) play();
      talkResume.current = false;
      showToast(p.kind === 'video' ? 'Talk off.' : 'Music restored to normal volume.');
    }
  };

  const editCues = (change: (cues: CueSlots) => CueSlots) => {
    if (!song) return;
    setUndoCues((history) => [...history.slice(-9), song.cues.map((cue) => cue && { ...cue })]);
    setSong((s) => s && { ...s, cues: change(s.cues) });
  };

  /**
   * Go to a set pad without changing play state; set an empty one; while editing, (re)set any pad. `launchOnly`
   * (Stage view) never sets or moves a cue.
   */
  const pressPad = (i: number, launchOnly = false) => {
    const p = playerRef.current;
    if (!p?.track || !song || failedVideoFile || (p instanceof VideoDeck && p.error)) return;
    const cue = song.cues[i] ?? null;
    if (!launchOnly && (editing || !cue)) {
      const time = p.position; // live, not the last ~50 ms report
      editCues((cues) => cues.map((c, j) => (j === i ? { time, name: c?.name ?? `Cue ${i + 1}` } : c)));
      void requestPersistentStorage(); // once per page load: keep saved cues from being evicted
      showToast(`Cue ${i + 1} ${cue ? 'moved' : 'set'} at ${formatTime(time)}. Tap it to return here.`);
      return;
    }
    if (cue) goToCue(cue.time);
  };

  const clearPad = (i: number) => editCues((cues) => cues.map((c, j) => (j === i ? null : c)));

  const renamePad = (i: number) => {
    const cue = song?.cues[i];
    if (!cue) return;
    const input = window.prompt(`Name for pad ${i + 1}`, cue.name);
    if (input === null) return;
    const name = input.trim() || cue.name;
    editCues((cues) => cues.map((c, j) => (j === i && c ? { ...c, name } : c)));
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
        ? 'Keep awake prevents dimming and auto-lock while ClassTempo is visible. Tap again to allow sleep.'
        : 'Keep awake could not be enabled. Battery saver or your browser may prevent it.');
    });
  };

  const closeStage = () => {
    setStageOpen(false);
    stageButton.current?.focus({ preventScroll: true });
  };

  const selectCuePanel = (panel: CuePanel) => {
    setEditing(false);
    setCuePanel(panel);
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
      if (!activeRef.current || modalOpen.current || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
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
      if (activeRef.current && !modalOpen.current && e.key === ' ' && !isTyping(e)) e.preventDefault();
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

  const handledRequest = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !request || handledRequest.current === request.id) return;
    // Keep the selected File in memory until the local deck is ready; no second picker tap.
    if (request.file && (!stretch || loading || classBusy)) return;
    handledRequest.current = request.id;
    if (request.file) void loadFile(request.file);
    else if (request.library) setLibraryOpen(true);
  }, [active, request, stretch, loading, classBusy]);

  const track = song?.track ?? null;
  const bpm = track?.bpm ? track.bpm * (tempo / 100) : null;
  const ready = player !== null && song !== null && !loading && !classBusy && !videoError && !failedVideoFile;
  const selectedSection = selectedPracticeSection(practice);
  const practiceActive = practice.mode !== 'off' && selectedSection !== null;
  const practiceConfigured = practiceActive || practice.delaySeconds > 0;
  const practiceRange = practiceActive ? `${formatTime(selectedSection.start)}–${formatTime(selectedSection.end)}` : '';
  const practiceProgress = practiceState.phase === 'complete' ? 'Complete · tap to restart'
    : practiceState.pass > 0 ? `Pass ${practiceState.pass}${practice.mode === 'repeat' && practice.repetitions !== null ? ` of ${practice.repetitions}` : ''}`
      : 'Ready · tap to start';
  const pendingLabel = waiting
    ? `${practiceState.phase === 'gap' ? 'Next repetition' : 'Get ready'} · ${Math.ceil(practiceState.remainingSeconds)}s`
    : null;
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
    loop: practice.mode !== 'off' && selectedSection ? { start: selectedSection.start, end: selectedSection.end } : null,
    positionRef,
    onSeek: seek,
    markers,
    scrub: true,
  };
  const classControls: ClassControlsProps | undefined = liveClass ? {
    className: liveClass.plan.name,
    items: liveClass.plan.entries.map((entry) => {
      const media = liveClass.media.find((item) => item.id === entry.mediaId);
      const section = entry.practice && selectedPracticeSection(entry.practice);
      return { id: entry.id, name: getClassEntryLabel(entry, media), note: entry.note,
        detail: section ? `${formatTime(section.start)}–${formatTime(section.end)} · ${Math.round((entry.practice?.tempo ?? 1) * 100)}% · ${entry.practice?.mode === 'repeat' ? entry.practice.repetitions === null ? 'Repeat until stopped' : `${entry.practice.repetitions} passes` : 'Once'}` : 'Full track · 100%',
        available: media?.available !== false };
    }),
    currentEntryId: liveClass.entryId, autoNext: liveClass.autoNext, busy: classBusy || loading,
    nextBusy: nextFileBusy, status: classStatus,
    onNext: nextClassEntry,
    onSelect: (id) => chooseClassEntry(id, false),
    onAutoNext: (enabled) => { const live = liveClassRef.current; if (live) { setLiveClass({ ...live, autoNext: enabled }); setClassStatus(enabled ? 'Auto-next on' : 'Next when ready'); rememberClass(); } },
    onExit: () => leaveClass(false),
    onOpenChange: setClassDrawerOpen,
  } : undefined;

  return (
    <section
      className={`dancer ${dragOver ? 'drag' : ''} ${videoElement ? 'has-video' : ''} ${liveClass ? 'has-live-class' : ''} ${videoError || failedVideoFile ? 'has-video-error' : ''} ${editing ? 'editing' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (stageOpen || !active) return;
        if (!loading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {actionsContainer && createPortal(<div className="dancer-actions" onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()}>
        <button onClick={() => fileInput.current?.click()} disabled={loading || classBusy}
          title="Open a song or video from Files or Photos">Open</button>
        <button onClick={() => setLibraryOpen(true)} disabled={loading || classBusy} title="Saved songs, videos and classes">
          Library
        </button>
        {wakeLock.supported && (
          <button
            className={`screen-on ${screenOn ? 'on' : ''}`}
            onClick={toggleScreenOn}
            aria-pressed={screenOn}
            aria-label="Keep awake"
            aria-describedby="screen-on-help"
            title={screenOn ? 'Screen stays on — tap to let it sleep again' : 'Keep the screen on (no dimming or auto-lock)'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span className="screen-on-label">Keep awake</span>
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
        <span id="screen-on-help" className="sr-only">Prevents dimming and auto-lock while ClassTempo is visible. Tap again to allow sleep.</span>
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
        {classControls && !stageOpen && <ClassControls {...classControls} />}
        {!liveClass && classResume && !classResume.finished && <button className="class-resume" disabled={loading || classBusy}
          onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}
          onClick={() => { void resumeClass(); }}>Resume {resumeName} <small>Opens paused</small></button>}
        <div className="dancer-track-info">
          {!liveClass && <NowPlayingLabel />}
          <div className="dancer-track-title" title={track?.name}>
            {loading ? 'Opening video or song…' : loadError ? loadError : track?.name ?? (deckError ? `Player failed to start: ${deckError}` : 'Tap Open to choose a song or video')}
          </div>
        </div>
        {failedVideoFile ? <div className="video-load-recovery">
          <p role="alert">This video could not open. Retry it or copy details to report the problem.</p>
          <div className="video-error-actions"><button onClick={retryVideo}>Retry video</button><button onClick={copyVideoDetails}>Copy details</button></div>
          {track && <button onClick={() => { setFailedVideoFile(null); setLoadError(null); }}>Return to loaded track</button>}
        </div> : videoElement ? (
          <div className="dancer-media" style={{ ['--video-ar' as string]: String(song?.aspect ?? 16 / 9) }}>
            {/* Stage borrows this same media element, preserving playback and the iOS gesture. */}
            <VideoView element={stageOpen ? null : videoElement} playing={playing} onTap={ready ? togglePlay : undefined} className="dancer-video" mirrored={practice.videoMirrored} zoom={practice.videoZoom}
              onRetry={currentFile && isVideoFile(currentFile) ? retryVideo : undefined} onDetails={copyVideoDetails} />
            {!videoError && <VideoTools mirrored={practice.videoMirrored} zoom={practice.videoZoom}
              onMirroredChange={(value) => updatePractice({ ...practice, videoMirrored: value }, false)}
              onZoomChange={(value) => updatePractice({ ...practice, videoZoom: value }, false)} />}
            <Waveform {...waveformProps} className="strip" />
          </div>
        ) : (
          <Waveform {...waveformProps} />
        )}
      </div>

      {pendingLabel && <div className="practice-countdown" role="status">{pendingLabel}</div>}

      <PlayerTransport playing={playing} disabled={!ready} onTogglePlay={togglePlay} onRestart={restart}
        onStage={() => setStageOpen(true)} stageRef={stageButton}
        playClassName={practiceActive ? 'practice-play' : ''}
        playTitle={practiceActive ? `${practice.mode === 'repeat' ? 'Repeat' : 'Play'} ${practiceRange}` : 'Space'}
        playLabel={videoError || failedVideoFile ? 'Video error' : waiting ? '✕ Cancel' : playing ? '❚❚ Pause' : practiceActive ? (practice.mode === 'repeat' ? '↻ Repeat' : '▶ Section') : '▶ Play'}
        playDetail={practiceActive && !videoError && !failedVideoFile ? waiting ? (practiceState.phase === 'gap' ? 'Between passes' : 'Starting soon') : practiceProgress : undefined}
        restartLabel={liveClass ? 'Again' : practiceActive ? 'Section' : 'Restart'} />

      {/* one box only where a layout needs it (phone landscape with a video: tempo above the pads); elsewhere its
          children sit straight on the card's grid (display: contents) */}
      <div className="dancer-side">
        <div className="class-tempo-panel">
          <TempoControl value={tempo} onChange={changeTempo} disabled={!ready} />
          <div className={`class-tools ${practiceConfigured ? 'has-practice' : ''}`}>
            <button className={`practice-open ${practiceActive || practice.delaySeconds > 0 ? 'on' : ''}`} aria-label="Practice"
              title={practiceActive ? `${selectedSection.name} · ${practiceRange}` : 'Create or open a saved practice'}
              onClick={(event) => { event.currentTarget.focus(); pause(); setPracticeOpen(true); }} disabled={!ready}>
              <span>Practice</span>
              {practiceActive && <small>{selectedSection.name}</small>}
            </button>
            {practiceConfigured && <button className="practice-end" onClick={endPractice} aria-label="End practice" title="Stop practice and return to normal playback">
              <span>End practice</span><small>Back to Play</small>
            </button>}
            <button className={talking ? 'on' : ''} aria-pressed={talking} onClick={toggleTalk} disabled={!ready}
              title={song?.kind === 'video' ? 'Pause the video while you talk; tap again to resume' : 'Lower the music while you talk; tap again to restore'}>
              {talking ? 'Finish talking' : 'Talk'}
            </button>
            <button disabled={!ready || tempo === 100} onClick={() => changeTempo(100)} title="Reset to original tempo">100%</button>
          </div>
        </div>

        <div className={`cues ${undoCues.length ? 'has-undo' : ''}`}>
          <div className="cues-head">
            <CueStemsSwitch value={cuePanel} onChange={selectCuePanel} />
            {cuePanel === 'cues' && (editing ? (
              <span className="dim cues-hint">Press a pad to move it here · ✕ clears · ✎ renames</span>
            ) : (
              <span className="dim cues-hint">
                <span className="hint-long">Tap an empty pad to set · Tap a saved cue to jump</span>
                <span className="hint-short">Tap empty to set</span>
              </span>
            ))}
            {cuePanel === 'cues' && (editing || undoCues.length > 0) && <button className="cues-undo" disabled={undoCues.length === 0} onClick={() => {
              const previous = undoCues[undoCues.length - 1];
              if (previous) { setSong((s) => s && { ...s, cues: previous }); setUndoCues((h) => h.slice(0, -1)); }
            }}>Undo</button>}
            {cuePanel === 'cues' && <button className={`cues-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} disabled={!ready}>
              {editing ? 'Done' : 'Edit cues'}
            </button>}
          </div>
          {cuePanel === 'cues'
            ? <CuePads cues={song?.cues ?? NO_CUES} launchLabel="Go to cue" editing={editing} disabled={!ready} onPress={pressPad} onClear={clearPad} onRename={renamePad} />
            : <StemsPanel kind={song?.kind ?? null} state={preparedStems.state}
              active={preparedStems.state.phase === 'ready' && player === preparedStems.deck.current}
              disabled={loading || !!failedVideoFile} mix={stemMix} focus={drumFocus}
              onPrepare={() => { engine.unlock(); void preparedStems.prepare(); }} onCancel={preparedStems.cancel}
              onActivate={useStems} onOriginal={() => { if (stretch) switchAudioPlayer(stretch); }}
              onMix={changeStemMix} onFocus={changeDrumFocus} onRemoveSaved={() => { void preparedStems.removeSaved(); }}
              onOpen={() => fileInput.current?.click()} />}
        </div>
      </div>

      <LibraryModal open={active && libraryOpen} onClose={() => setLibraryOpen(false)}
        onNotice={showToast}
        onTeachClass={teachClass} activeClassId={liveClass?.plan.id}
        currentFile={currentFile} currentTitle={track?.name ?? null}
        currentPractice={practice} currentDuration={track?.duration}
        onLoad={async (file, id, exercise) => {
          if (!await loadFile(file, id)) throw new Error('This file could not be opened.');
          if (exercise && playerRef.current?.track) {
            const next = normalizePracticeSettings(exercise, playerRef.current.track.duration);
            practiceRef.current = next; setPractice(next);
            playerRef.current.setTempo(next.tempo); setTempo(Math.round(next.tempo * 100));
          }
        }} />
      {active && practiceOpen && track && <PracticePanel settings={practice} onChange={savePractice}
        cues={song?.cues ?? NO_CUES} onStart={startPractice} onEnd={endPractice}
        position={displayPos} duration={track.duration} delayDisabled={song?.kind === 'video' && !videoStarted.current} onClose={() => setPracticeOpen(false)} />}

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

      {active && stageOpen && song && (
        <StageView
          classControls={classControls}
          video={videoElement}
          aspect={song.aspect}
          title={song.track.name}
          playing={playing}
          position={displayPos}
          duration={song.track.duration}
          onSeek={seek}
          onOpenPractice={() => { pause(); setStageOpen(false); setPracticeOpen(true); }}
          cues={song.cues}
          section={cueSection(song.cues, displayPos).current?.name ?? null}
          onTogglePlay={togglePlay}
          onRestart={restart}
          onLaunch={(i) => pressPad(i, true)}
          cueActionLabel="Go to"
          onSetCue={(i) => pressPad(i)}
          onClose={closeStage}
          tempo={tempo}
          onTempoChange={changeTempo}
          mirrored={practice.videoMirrored}
          zoom={practice.videoZoom}
          onMirroredChange={(value) => updatePractice({ ...practice, videoMirrored: value }, false)}
          onZoomChange={(value) => updatePractice({ ...practice, videoZoom: value }, false)}
          onRestartSection={practiceActive ? restart : undefined}
          practiceName={practiceActive ? selectedSection.name : practice.delaySeconds > 0 ? 'Start delay' : undefined}
          practiceRange={practiceActive ? selectedSection : undefined}
          onEndPractice={practiceConfigured ? endPractice : undefined}
          pendingLabel={pendingLabel}
          talking={talking}
          onToggleTalk={toggleTalk}
          onRetryVideo={retryVideo}
          onVideoDetails={copyVideoDetails}
        />
      )}
    </section>
  );
}
