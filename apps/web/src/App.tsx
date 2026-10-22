import { Engine } from '@mixdeck/engine';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { DeckView } from './components/DeckView';
import { Mixer } from './components/Mixer';
import { isDancerPlaying, restartDancerKeepAlive } from './dancer/dancerAudio';
import { DancerMode } from './dancer/DancerMode';
import { watchAudioContext } from './platform/audioRecovery';
import { initialDeckState, type DeckUiState } from './types';
import './shell.css';

type Mode = 'dancer' | 'dj';

/** The header's mode pills, in order. Every launch opens in Dancer mode. */
const MODES: readonly { id: Mode; label: string }[] = [
  { id: 'dancer', label: 'Dancer' },
  { id: 'dj', label: 'DJ' },
];

/**
 * Events that carry user activation, in every browser's flavour: pointerdown (mouse), pointerup and touchend
 * (touch; WebKit counts touchend), keydown. The first one the browser honours starts the audio context.
 */
const UNLOCK_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>('dancer');
  const [a, setA] = useState<DeckUiState>(initialDeckState);
  const [b, setB] = useState<DeckUiState>(initialDeckState);
  const [needsGesture, setNeedsGesture] = useState(false);
  // one engine for the life of the page: a ref survives StrictMode's double effect run and Fast Refresh
  const creating = useRef<Promise<Engine> | null>(null);
  const pills = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});

  // The engine is created on launch, no tap needed: its context starts 'suspended' and the first tap starts it.
  useEffect(() => {
    let live = true;
    creating.current ??= Engine.create();
    const pending = creating.current;
    pending.then(
      (e) => {
        if (live) setEngine(e);
      },
      (e: unknown) => {
        if (!live) return;
        creating.current = null; // "Try again" creates a new one
        setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  // the first tap, click or key press anywhere starts the audio context; disarmed once it runs
  useEffect(() => {
    if (!engine) return;
    const { ctx } = engine;
    const unlock = () => engine.unlock();
    const disarm = () => {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, unlock, true);
      ctx.removeEventListener('statechange', onStateChange);
    };
    const onStateChange = () => {
      if (ctx.state === 'running') disarm();
    };
    if (ctx.state === 'running') return;
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, unlock, { capture: true, passive: true });
    ctx.addEventListener('statechange', onStateChange);
    return disarm;
  }, [engine]);

  // interruptions (calls, Siri, alarms, other apps): resume on our own, or ask for a tap when the browser wants one
  useEffect(() => {
    if (!engine) return;
    return watchAudioContext(engine.ctx, {
      shouldBeRunning: () => engine.decks.some((d) => d.playing) || isDancerPlaying(),
      onNeedsGesture: setNeedsGesture,
      onResumeAttempt: restartDancerKeepAlive,
    });
  }, [engine]);

  /** The tap the browser asked for: resumes the context (and the Dancer keep-alive) inside the gesture. */
  const resumeAudio = useCallback(() => {
    if (!engine) return;
    restartDancerKeepAlive();
    // the watcher hides the overlay once the context runs; if this resume is refused it stays up for another tap
    void engine.resume().then(
      () => {
        if (engine.ctx.state === 'running') setNeedsGesture(false);
      },
      () => {},
    );
  }, [engine]);

  /**
   * A pill tap (or arrow key) is a user gesture: it starts the audio context if it is not running yet. Leaving DJ
   * mode pauses both decks; Dancer mode pauses itself when it stops being active. Both modes stay mounted, so
   * loaded songs, cues, tempo and mixer settings survive the switch.
   */
  const switchMode = useCallback(
    (next: Mode) => {
      if (!engine) return;
      engine.unlock();
      if (next === mode) return;
      if (mode === 'dj') {
        const [deckA, deckB] = engine.decks;
        if (deckA.playing) {
          deckA.pause();
          setA((s) => ({ ...s, playing: false }));
        }
        if (deckB.playing) {
          deckB.pause();
          setB((s) => ({ ...s, playing: false }));
        }
      }
      setMode(next);
    },
    [engine, mode],
  );

  /** Radio-group keys: arrows / Home / End move the selection (and focus); Space stays here, not Dancer's play. */
  const onPillKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = MODES.findIndex((m) => m.id === mode);
    let j: number;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        j = (i + MODES.length - 1) % MODES.length;
        break;
      case 'ArrowRight':
      case 'ArrowDown':
        j = (i + 1) % MODES.length;
        break;
      case 'Home':
        j = 0;
        break;
      case 'End':
        j = MODES.length - 1;
        break;
      case ' ':
      case 'Enter':
        // the focused pill is the checked one: its native click is all that should happen
        e.stopPropagation();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    const next = MODES[j];
    if (!next) return;
    switchMode(next.id);
    pills.current[next.id]?.focus();
  };

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (!engine) {
    return (
      <div className="splash">
        <span className="splash-logo">MixDeck</span>
        {error ? (
          <div className="splash-error" role="alert">
            <p className="error">Audio could not start: {error}</p>
            <button type="button" onClick={retry}>
              Try again
            </button>
          </div>
        ) : (
          <p className="splash-status" role="status">
            Loading…
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="head-left">
          <span className="logo">MixDeck</span>
          <div className="mode-switch" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => {
              const on = m.id === mode;
              return (
                <button
                  key={m.id}
                  ref={(el) => {
                    pills.current[m.id] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className="mode-pill"
                  onClick={() => switchMode(m.id)}
                  onKeyDown={onPillKeyDown}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
        <AudioMeta engine={engine} />
      </header>
      <main className="dancer-main" hidden={mode !== 'dancer'}>
        <DancerMode engine={engine} active={mode === 'dancer'} />
      </main>
      <main className="dj-main" hidden={mode !== 'dj'}>
        <p className="rotate-hint">Rotate your phone for the full mixer</p>
        <DeckView label="A" accent="var(--a)" engine={engine} deck={engine.decks[0]} state={a} setState={setA} other={b} active={mode === 'dj'} />
        <Mixer engine={engine} a={a} b={b} />
        <DeckView label="B" accent="var(--b)" engine={engine} deck={engine.decks[1]} state={b} setState={setB} other={a} active={mode === 'dj'} />
      </main>
      {needsGesture && <ResumeAudioButton onResume={resumeAudio} />}
    </div>
  );
}

/** A fullscreen element owns the browser's top layer: recovery must be inside it to remain reachable. */
function ResumeAudioButton({ onResume }: { onResume: () => void }) {
  const fullscreenRoot = () => {
    const d = document as Document & { webkitFullscreenElement?: Element | null };
    return d.fullscreenElement ?? d.webkitFullscreenElement ?? d.body;
  };
  const [container, setContainer] = useState(fullscreenRoot);
  useEffect(() => {
    const onChange = () => setContainer(fullscreenRoot());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    onChange();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);
  return createPortal(
    <button className="resume-audio" onClick={onResume} autoFocus>
      <strong>Tap to resume audio</strong>
      <span>Playback was interrupted</span>
    </button>,
    container,
  );
}

/** Sample rate and output latency; re-read when the context starts (output latency is only known once it runs). */
function AudioMeta({ engine }: { engine: Engine }) {
  const [, setState] = useState(engine.ctx.state);
  useEffect(() => {
    const { ctx } = engine;
    const onChange = () => setState(ctx.state);
    ctx.addEventListener('statechange', onChange);
    return () => ctx.removeEventListener('statechange', onChange);
  }, [engine]);
  return (
    <span className="meta">
      {engine.ctx.sampleRate / 1000} kHz · ~{Math.round(engine.latency * 1000)} ms out
    </span>
  );
}
