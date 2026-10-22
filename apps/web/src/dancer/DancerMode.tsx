import { downmix } from '@mixdeck/analysis';
import type { Engine, StretchDeck } from '@mixdeck/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analysis } from '../analysisClient';
import { Waveform, type WaveformMarker } from '../components/Waveform';
import { makeDemoTrack } from '../demo';
import { nextCueTime, previousCueTime } from '../platform/cueNavigation';
import { createKeepAlive } from '../platform/keepAlive';
import { clearMediaSession, setHandlers, setNowPlaying, setPlaybackState, setPosition } from '../platform/mediaSession';
import { requestPersistentStorage } from '../platform/persist';
import { createWakeLock } from '../platform/wakeLock';
import { formatTime, type TrackState } from '../types';
import { CuePads, padColor } from './CuePads';
import { emptyCues, loadCues, saveCues, type CueSlots } from './cueStore';
import { dancerAudio } from './dancerAudio';
import { clampTempo, TempoControl } from './TempoControl';

interface Props {
  engine: Engine;
}

/** The loaded song and its cues travel together so a cue save can never target the wrong track. */
interface Song {
  track: TrackState;
  cues: CueSlots;
}

const NO_CUES: CueSlots = emptyCues();

/** Second line of the lock-screen Now Playing card. */
const MEDIA_ARTIST = 'MixDeck · Dancer mode';
/** Lock-screen scrubber refresh while playing, ms (the OS extrapolates in between). */
const POSITION_SYNC_MS = 5000;

/** Keys are ignored while typing; range sliders and buttons still get the shortcuts. */
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target;
  if (t instanceof HTMLTextAreaElement) return true;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type);
  return false;
}

/** Minimal single-song player: launchable cue pads and key-locked tempo. No EQ, no mixer. */
export function DancerMode({ engine }: Props) {
  const [deck, setDeck] = useState<StretchDeck | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** percent */
  const [tempo, setTempo] = useState(100);
  const [editing, setEditing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const positionRef = useRef(0);
  const [displayPos, setDisplayPos] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  // one of each per mount; nothing is built until first use
  const [keepAlive] = useState(createKeepAlive);
  const [screenOn, setScreenOn] = useState(false);
  // "Keep screen on" follows the lock the browser actually holds: a refused request, a failed re-acquire on
  // return, or a lock the system drops (battery saver / Low Power Mode) switches the toggle back off
  const [wakeLock] = useState(() => {
    const lock = createWakeLock({
      onChange: (held) => {
        setScreenOn(held);
        if (!held) void lock.disable();
      },
    });
    return lock;
  });

  // the engine's shared key-locked deck (its processor cannot be destroyed, so it is never recreated);
  // released on unmount, which also covers StrictMode's double mount
  useEffect(() => {
    const slot: { live: boolean; deck: StretchDeck | null } = { live: true, deck: null };
    engine.getStretchDeck().then(
      (d) => {
        if (!slot.live) return;
        slot.deck = d;
        setDeck(d);
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

  // silent keep-alive and screen wake lock go with the mode
  useEffect(
    () => () => {
      keepAlive.stop();
      keepAlive.dispose();
      void wakeLock.disable();
    },
    [keepAlive, wakeLock],
  );

  // App's audio recovery reads whether we are playing and restarts our keep-alive after an interruption
  useEffect(() => {
    if (!deck) return;
    dancerAudio.deck = deck;
    dancerAudio.keepAlive = keepAlive;
    return () => {
      if (dancerAudio.deck !== deck) return;
      dancerAudio.deck = null;
      dancerAudio.keepAlive = null;
    };
  }, [deck, keepAlive]);

  /** Lock-screen play/pause state and scrubber, from the deck itself (always current, also mid-load). */
  const syncMedia = useCallback(() => {
    const track = deck?.track;
    if (!deck || !track) return;
    setPlaybackState(deck.playing ? 'playing' : 'paused');
    setPosition({ duration: track.duration, position: deck.position, rate: deck.tempo });
  }, [deck]);

  // deck → ref (~every 50 ms); ref → text at 10 Hz; the waveform reads the ref via rAF
  useEffect(() => {
    if (!deck) return;
    deck.onPosition = (s) => {
      positionRef.current = s;
    };
    deck.onEnded = () => {
      setPlaying(false);
      keepAlive.stop();
      syncMedia();
    };
    const t = setInterval(() => setDisplayPos(positionRef.current), 100);
    return () => {
      deck.onPosition = null;
      deck.onEnded = null;
      clearInterval(t);
    };
  }, [deck, keepAlive, syncMedia]);

  // the OS extrapolates the scrubber at the tempo; re-anchor it now and then against drift
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(syncMedia, POSITION_SYNC_MS);
    return () => clearInterval(t);
  }, [playing, syncMedia]);

  // cues persist per track
  useEffect(() => {
    if (song) saveCues(song.track.name, song.track.duration, song.cues);
  }, [song]);

  const loadBuffer = useCallback(
    async (buffer: AudioBuffer, name: string) => {
      if (!deck) return;
      setLoading(true);
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      const mono = downmix(channels);
      keepAlive.stop(); // loading pauses the deck
      try {
        await deck.load(buffer, name);
        deck.setTempo(1);
        positionRef.current = 0;
        setDisplayPos(0);
        setPlaying(false);
        setTempo(100);
        setEditing(false);
        setSong({
          track: { name, duration: buffer.duration, bpm: null, firstBeat: 0, peaks: null, analyzing: true },
          cues: loadCues(name, buffer.duration),
        });
        syncMedia(); // the Now Playing effect below only re-runs when the name changes
      } catch (e) {
        // the deck dropped its buffers before failing, so the previous song is gone too: back to the empty state
        console.error(e);
        positionRef.current = 0;
        setDisplayPos(0);
        setPlaying(false);
        setSong(null);
        return;
      } finally {
        setLoading(false);
      }
      // analysis runs on after loading has finished; a failure just leaves the track un-analysed
      try {
        const r = await analysis.analyze(mono, buffer.sampleRate);
        setSong((s) =>
          s && s.track.name === name
            ? { ...s, track: { ...s.track, bpm: r.confidence > 1.5 ? r.bpm : null, firstBeat: r.firstBeat, peaks: r.peaks, analyzing: false } }
            : s,
        );
      } catch (e) {
        console.error(e);
        setSong((s) => (s && s.track.name === name ? { ...s, track: { ...s.track, analyzing: false } } : s));
      }
    },
    [deck, keepAlive, syncMedia],
  );

  /** Decodes and loads one file. Ignored until the deck is ready and while another load is running (drops are not gated by a disabled button). */
  const loadFile = useCallback(
    async (file: File) => {
      if (!deck || loading) return;
      setLoading(true);
      let buffer: AudioBuffer;
      try {
        buffer = await engine.decode(file);
      } catch (e) {
        console.error(e);
        setLoading(false);
        return;
      }
      await loadBuffer(buffer, file.name);
    },
    [engine, deck, loading, loadBuffer],
  );

  const loadDemo = () => void loadBuffer(makeDemoTrack(engine.ctx, 120), 'Demo 120 BPM');

  const seek = (seconds: number) => {
    if (!deck || !song) return;
    deck.seek(seconds); // reports the new position through onPosition
    setDisplayPos(deck.position);
    syncMedia();
  };

  /**
   * Everything that starts playback runs inside a tap, key press or lock-screen action: start the keep-alive
   * there (synchronously, it needs the gesture), and resume a context left suspended by an interruption that
   * ended while paused (no statechange would bring it back).
   */
  const wake = () => {
    void keepAlive.start();
    if (engine.ctx.state !== 'running') void engine.resume().catch(() => {});
  };

  const play = () => {
    if (!deck || !song) return;
    wake();
    deck.play();
    if (!deck.playing) keepAlive.stop(); // e.g. mid-load (no track yet): don't leave the page "playing"
    setPlaying(deck.playing);
    syncMedia();
  };

  const pause = () => {
    if (!deck || !song) return;
    deck.pause();
    keepAlive.stop();
    setPlaying(false);
    syncMedia();
  };

  const togglePlay = () => (deck?.playing ? pause() : play());

  const restart = () => seek(0);

  /** Jump to `seconds` and play: cue launch, and lock-screen / headphone previous and next. */
  const launch = (seconds: number) => {
    if (!deck || !song) return;
    wake();
    deck.jumpTo(seconds);
    if (!deck.playing) keepAlive.stop();
    setPlaying(deck.playing);
    syncMedia();
  };

  const cueTimes = (): (number | null)[] => song?.cues.map((c) => c?.time ?? null) ?? [];

  const previousCue = () => {
    if (deck) launch(previousCueTime(cueTimes(), deck.position));
  };

  const nextCue = () => {
    if (!deck) return;
    const t = nextCueTime(cueTimes(), deck.position);
    if (t !== null) launch(t);
  };

  const changeTempo = (percent: number) => {
    if (!deck) return;
    const p = clampTempo(percent);
    deck.setTempo(p / 100);
    setTempo(p);
    syncMedia();
  };

  /** Launch a set pad; set an empty one; while editing, (re)set any pad to the current position. */
  const pressPad = (i: number) => {
    if (!deck || !song) return;
    const cue = song.cues[i] ?? null;
    if (editing || !cue) {
      const time = deck.position; // live, not the last ~50 ms report
      setSong((s) => s && { ...s, cues: s.cues.map((c, j) => (j === i ? { time, name: c?.name ?? `Cue ${i + 1}` } : c)) });
      void requestPersistentStorage(); // once per page load: keep saved cues from being evicted
      return;
    }
    launch(cue.time);
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

  /** "Keep screen on": shown on at once; the wake lock's onChange switches it back off if the lock is refused. */
  const toggleScreenOn = () => {
    if (screenOn) {
      setScreenOn(false);
      void wakeLock.disable();
      return;
    }
    setScreenOn(true);
    void wakeLock.enable();
  };

  // keyboard and lock-screen controls: the latest handlers live in refs so the single listener and the
  // once-registered Media Session handlers never see a stale closure
  const keys = useRef({ pressPad, togglePlay, restart, changeTempo, tempo });
  const remote = useRef({ play, pause, seek, previousCue, nextCue });
  useEffect(() => {
    keys.current = { pressPad, togglePlay, restart, changeTempo, tempo };
    remote.current = { play, pause, seek, previousCue, nextCue };
  });

  // lock-screen and headphone controls for the loaded song; cleared when it is unloaded and on unmount
  const trackName = song?.track.name ?? null;
  useEffect(() => {
    if (!deck || trackName === null) return;
    setNowPlaying({ title: trackName, artist: MEDIA_ARTIST });
    setHandlers({
      play: () => remote.current.play(),
      pause: () => remote.current.pause(),
      stop: () => {
        remote.current.pause();
        remote.current.seek(0);
      },
      previoustrack: () => remote.current.previousCue(),
      nexttrack: () => remote.current.nextCue(),
      // fastSeek (a scrub in progress) needs nothing different: a seek is a single scheduled change
      seekto: (details) => {
        if (details.seekTime !== undefined) remote.current.seek(details.seekTime);
      },
    });
    syncMedia();
    return clearMediaSession;
  }, [deck, trackName, syncMedia]);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const h = keys.current;
      if (e.key.length === 1 && e.key >= '1' && e.key <= '8') {
        if (!e.repeat) h.pressPad(Number(e.key) - 1);
      } else if (e.key === ' ') {
        if (!e.repeat) h.togglePlay();
      } else if (e.key === 'ArrowLeft') {
        h.changeTempo(h.tempo - 1);
      } else if (e.key === 'ArrowRight') {
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
      if (e.key === ' ' && !isTyping(e)) e.preventDefault();
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

  /** Drops are accepted (and the panel highlighted) only when a load could start. */
  const canLoad = deck !== null && !loading;

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && canLoad) void loadFile(file);
  };

  const track = song?.track ?? null;
  const bpm = track?.bpm ? track.bpm * (tempo / 100) : null;
  const ready = deck !== null && song !== null;

  return (
    <section
      className={`dancer ${dragOver ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (canLoad) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="dancer-head">
        <div className="deck-title" title={track?.name}>
          {deckError
            ? `Player failed to start: ${deckError}`
            : !deck
              ? 'Preparing key-locked player…'
              : loading
                ? 'Decoding…'
                : track
                  ? track.name
                  : 'Load a song or drop one here'}
        </div>
        <button onClick={loadDemo} disabled={!canLoad} title="Synthesised test track">
          Demo
        </button>
        <button onClick={() => fileInput.current?.click()} disabled={!canLoad}>
          Load
        </button>
        {wakeLock.supported && (
          <button
            className={`screen-on ${screenOn ? 'on' : ''}`}
            onClick={toggleScreenOn}
            aria-pressed={screenOn}
            aria-label="Keep screen on"
            title="Keep screen on"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span className="screen-on-label">Keep screen on</span>
          </button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.m4a,.aac,.wav,.aif,.aiff,.flac,.ogg"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="dancer-clock">
        <span className="elapsed">{formatTime(displayPos)}</span>
        <span className="total">/ {formatTime(track?.duration ?? 0)}</span>
        <span className="bpm">
          <span className="big">{bpm ? bpm.toFixed(1) : track?.analyzing ? '…' : '--'}</span>
          <span className="unit">BPM</span>
        </span>
      </div>

      <Waveform
        peaks={track?.peaks ?? null}
        duration={track?.duration ?? 0}
        bpm={track?.bpm ?? null}
        firstBeat={track?.firstBeat ?? 0}
        loop={null}
        positionRef={positionRef}
        onSeek={seek}
        markers={markers}
      />

      <div className="dancer-transport">
        <button className={`play ${playing ? 'on' : ''}`} onClick={togglePlay} disabled={!ready} title="Space">
          {playing ? '❚❚  Pause' : '▶  Play'}
        </button>
        <button onClick={restart} disabled={!ready} title="Home">
          ⟲ Restart
        </button>
      </div>

      <TempoControl value={tempo} onChange={changeTempo} disabled={!ready} />

      <div className="cues">
        <div className="cues-head">
          <h2>Cues</h2>
          {editing ? (
            <span className="dim cues-hint">Press a pad to move it here · ✕ clears · ✎ renames</span>
          ) : (
            <span className="dim cues-hint">
              <span className="hint-long">Empty pad: set a cue here · set pad: launch it</span>
              <span className="hint-short">Tap empty pad to set · tap set pad to launch</span>
            </span>
          )}
          <button className={`cues-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} disabled={!ready}>
            Edit cues
          </button>
        </div>
        <CuePads cues={song?.cues ?? NO_CUES} editing={editing} disabled={!ready} onPress={pressPad} onClear={clearPad} onRename={renamePad} />
      </div>

      <p className="dancer-hint kbd-hint">
        <kbd>1</kbd>–<kbd>8</kbd> pads · <kbd>Space</kbd> play / pause · <kbd>←</kbd> <kbd>→</kbd> tempo ±1 % · <kbd>Home</kbd> restart
      </p>
    </section>
  );
}
