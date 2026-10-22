import { Engine, type EqBand } from '@mixdeck/engine';
import { useCallback, useEffect, useState } from 'react';
import { DeckView } from './components/DeckView';
import { Mixer } from './components/Mixer';
import { isDancerPlaying, restartDancerKeepAlive } from './dancer/dancerAudio';
import { DancerMode } from './dancer/DancerMode';
import { watchAudioContext } from './platform/audioRecovery';
import { initialDeckState, type DeckUiState } from './types';

type Mode = 'dj' | 'dancer';

const BANDS: EqBand[] = ['low', 'mid', 'high'];

export function App() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [starting, setStarting] = useState<Mode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<DeckUiState>(initialDeckState);
  const [b, setB] = useState<DeckUiState>(initialDeckState);
  const [needsGesture, setNeedsGesture] = useState(false);

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

  /** Entering a mode is the user gesture that creates (or resumes) the audio engine. */
  const enter = useCallback(
    async (next: Mode) => {
      setError(null);
      if (engine) {
        void engine.resume();
        setMode(next);
        return;
      }
      setStarting(next);
      try {
        setEngine(await Engine.create());
        setMode(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStarting(null);
      }
    },
    [engine],
  );

  /** Back to the start screen: silence and empty the DJ decks (the Dancer deck tears itself down), keep the engine. */
  const showModes = useCallback(() => {
    if (engine) {
      for (const d of engine.decks) {
        d.pause();
        d.unload();
        d.setPitch(0);
        d.setFader(1);
        for (const band of BANDS) d.setEq(band, 0);
      }
      engine.setCrossfader(0);
      engine.setMasterGain(0.9);
    }
    setA(initialDeckState);
    setB(initialDeckState);
    setMode(null);
  }, [engine]);

  if (!engine || !mode) {
    return (
      <div className="gate">
        <h1>MixDeck</h1>
        <p className="gate-sub">DJ two decks, or rehearse a song with cue pads and key-locked tempo.</p>
        <div className="modes">
          <button className="mode mode-dj" onClick={() => void enter('dj')} disabled={starting !== null}>
            <strong>{starting === 'dj' ? 'Starting audio…' : 'DJ mode'}</strong>
            <span>Two decks, mixer, sync</span>
          </button>
          <button className="mode mode-dancer" onClick={() => void enter('dancer')} disabled={starting !== null}>
            <strong>{starting === 'dancer' ? 'Starting audio…' : 'Dancer mode'}</strong>
            <span>One song, launchable cues, tempo with key lock</span>
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint">
          DJ mode pitch changes key (key lock lands in Phase 1); Dancer mode keeps the key at any tempo. Install to your Home Screen
          on iPhone / iPad or Android for the best experience.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <div className="head-left">
          <span className="logo">MixDeck</span>
          <span className="mode-tag">{mode === 'dj' ? 'DJ mode' : 'Dancer mode'}</span>
          <button className="modes-btn" onClick={showModes} title="Back to the start screen">
            Modes
          </button>
        </div>
        <span className="meta">
          {engine.ctx.sampleRate / 1000} kHz · ~{Math.round(engine.latency * 1000)} ms out
        </span>
      </header>
      {mode === 'dj' ? (
        <main className="dj-main">
          <p className="rotate-hint">Rotate your phone for the full mixer</p>
          <DeckView label="A" accent="var(--a)" engine={engine} deck={engine.decks[0]} state={a} setState={setA} other={b} />
          <Mixer engine={engine} a={a} b={b} />
          <DeckView label="B" accent="var(--b)" engine={engine} deck={engine.decks[1]} state={b} setState={setB} other={a} />
        </main>
      ) : (
        <main className="dancer-main">
          <DancerMode engine={engine} />
        </main>
      )}
      {needsGesture && (
        <button className="resume-audio" onClick={resumeAudio}>
          <strong>Tap to resume audio</strong>
          <span>Playback was interrupted</span>
        </button>
      )}
    </div>
  );
}
