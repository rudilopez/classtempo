import { beatBefore, downmix } from '@mixdeck/analysis';
import type { Deck, Engine } from '@mixdeck/engine';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { analysis } from '../analysisClient';
import { makeDemoTrack } from '../demo';
import { effectiveBpm, formatTime, type DeckUiState } from '../types';
import { Waveform } from './Waveform';

interface Props {
  label: string;
  accent: string;
  engine: Engine;
  deck: Deck;
  state: DeckUiState;
  setState: Dispatch<SetStateAction<DeckUiState>>;
  other: DeckUiState;
  active: boolean;
}

const PITCH_RANGE = 8;

export function DeckView({ label, accent, engine, deck, state, setState, other, active }: Props) {
  const positionRef = useRef(0);
  const [displayPos, setDisplayPos] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // worklet → ref (every ~21 ms); ref → text at 10 Hz; the waveform reads the ref via rAF
  useEffect(() => {
    deck.onPosition = (s) => {
      positionRef.current = s;
    };
    deck.onEnded = () => setState((s) => ({ ...s, playing: false }));
    return () => {
      deck.onPosition = null;
      deck.onEnded = null;
    };
  }, [deck, setState]);

  useEffect(() => {
    if (!active) return;
    setDisplayPos(positionRef.current);
    const t = setInterval(() => setDisplayPos(positionRef.current), 100);
    return () => clearInterval(t);
  }, [active]);

  const loadBuffer = useCallback(
    async (buffer: AudioBuffer, name: string) => {
      const channels: Float32Array[] = [];
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
      const mono = downmix(channels);
      deck.load(buffer, name);
      deck.setPitch(0);
      positionRef.current = 0;
      setState({
        track: { name, duration: buffer.duration, bpm: null, firstBeat: 0, peaks: null, analyzing: true },
        pitch: 0,
        playing: false,
        loop: null,
        loading: false,
      });
      const r = await analysis.analyze(mono, buffer.sampleRate);
      setState((s) =>
        s.track?.name === name
          ? { ...s, track: { ...s.track, bpm: r.confidence > 1.5 ? r.bpm : null, firstBeat: r.firstBeat, peaks: r.peaks, analyzing: false } }
          : s,
      );
    },
    [deck, setState],
  );

  const loadFile = useCallback(
    async (file: File) => {
      setState((s) => ({ ...s, loading: true }));
      try {
        await loadBuffer(await engine.decode(file), file.name);
      } catch (e) {
        console.error(e);
        setState((s) => ({ ...s, loading: false }));
      }
    },
    [engine, loadBuffer, setState],
  );

  const loadDemo = () => {
    const bpm = label === 'A' ? 124 : 128;
    void loadBuffer(makeDemoTrack(engine.ctx, bpm), `Demo ${bpm} BPM`);
  };

  /**
   * Inside the tap: resume a context that an interruption (call, Siri, other app audio, page hidden) left
   * suspended while every deck was paused; no statechange would bring it back, so the deck would play silently.
   */
  const togglePlay = () => {
    if (!deck.playing && engine.ctx.state !== 'running') void engine.resume().catch(() => {});
    deck.toggle();
    setState((s) => ({ ...s, playing: deck.playing }));
  };

  const cue = () => {
    deck.cue();
    setState((s) => ({ ...s, playing: deck.playing }));
  };

  const setPitch = (p: number) => {
    deck.setPitch(p);
    setState((s) => ({ ...s, pitch: p }));
  };

  /** Tempo sync (phase lock lands in Phase 1). */
  const sync = () => {
    const target = effectiveBpm(other);
    const mine = state.track?.bpm;
    if (!target || !mine) return;
    const p = (target / mine - 1) * 100;
    setPitch(Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, Math.round(p * 100) / 100)));
  };

  const toggleLoop = (beats: number) => {
    if (state.loop) {
      deck.setLoop(null);
      setState((s) => ({ ...s, loop: null }));
      return;
    }
    const t = state.track;
    if (!t) return;
    const pos = positionRef.current;
    const start = t.bpm ? Math.max(0, beatBefore(pos, t.bpm, t.firstBeat)) : pos;
    const length = t.bpm ? (beats * 60) / t.bpm : 2;
    const loop = { start, end: Math.min(t.duration, start + length) };
    deck.setLoop(loop);
    setState((s) => ({ ...s, loop }));
  };

  const seek = (seconds: number) => {
    deck.seek(seconds);
    positionRef.current = seconds;
    setDisplayPos(seconds);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  const t = state.track;
  const bpm = effectiveBpm(state);

  return (
    <section
      className={`deck ${dragOver ? 'drag' : ''}`}
      style={{ ['--accent' as string]: accent }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="deck-head">
        <span className="deck-label">{label}</span>
        <div className="deck-title" title={t?.name}>
          {state.loading ? 'Decoding…' : t ? t.name : 'Load a track or drop one here'}
        </div>
        <button onClick={loadDemo} title="Synthesised test track">
          Demo
        </button>
        <button onClick={() => fileInput.current?.click()}>Load</button>
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

      <div className="deck-info">
        <span className="big">{bpm ? bpm.toFixed(2) : t?.analyzing ? '…' : '--'}</span>
        <span className="unit">BPM</span>
        <span className="time">{formatTime(displayPos)}</span>
        <span className="time dim">-{formatTime((t?.duration ?? 0) - displayPos)}</span>
      </div>

      <Waveform
        active={active}
        peaks={t?.peaks ?? null}
        duration={t?.duration ?? 0}
        bpm={t?.bpm ?? null}
        firstBeat={t?.firstBeat ?? 0}
        loop={state.loop}
        cuePoint={deck.cuePoint}
        positionRef={positionRef}
        onSeek={seek}
      />

      <div className="transport">
        <button className="cue" onClick={cue} disabled={!t}>
          CUE
        </button>
        <button className={`play ${state.playing ? 'on' : ''}`} onClick={togglePlay} disabled={!t}>
          {state.playing ? '❚❚' : '▶'}
        </button>
        <button className={state.loop ? 'on' : ''} onClick={() => toggleLoop(4)} disabled={!t}>
          LOOP 4
        </button>
        <button onClick={sync} disabled={!t?.bpm || !other.track?.bpm} title="Match tempo to the other deck">
          SYNC
        </button>
      </div>

      <div className="pitch">
        <label>
          Pitch {state.pitch >= 0 ? '+' : ''}
          {state.pitch.toFixed(2)}%
        </label>
        <input
          type="range"
          min={-PITCH_RANGE}
          max={PITCH_RANGE}
          step={0.01}
          value={state.pitch}
          onChange={(e) => setPitch(Number(e.target.value))}
          onDoubleClick={() => setPitch(0)}
        />
      </div>
    </section>
  );
}
