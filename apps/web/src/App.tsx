import { Engine } from '@mixdeck/engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isDancerPlaying, restartDancerKeepAlive } from './dancer/dancerAudio';
import { DancerMode } from './dancer/DancerMode';
import { watchAudioContext } from './platform/audioRecovery';
import './shell.css';

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
  const [needsGesture, setNeedsGesture] = useState(false);
  const [dancerActions, setDancerActions] = useState<HTMLDivElement | null>(null);
  // one engine for the life of the page: a ref survives StrictMode's double effect run and Fast Refresh
  const creating = useRef<Promise<Engine> | null>(null);

  // The engine is created on launch, no tap needed: its context starts 'suspended' and the first tap starts it.
  useEffect(() => {
    let live = true;
    creating.current ??= Engine.create({ dj: false });
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
      shouldBeRunning: isDancerPlaying,
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

  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  if (!engine) {
    return (
      <div className="splash">
        <span className="splash-logo">Class<span>Tempo</span></span>
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
          <span className="logo">Class<span>Tempo</span></span>
        </div>
        <div className="header-actions" ref={setDancerActions} />
      </header>
      <main className="dancer-main">
        <DancerMode engine={engine} active actionsContainer={dancerActions} />
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
