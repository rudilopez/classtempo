import type { DrumFocus, StemMix } from '@mixdeck/engine';
import { useEffect, useId, useState } from 'react';
import type { PreparedStemsState } from './usePreparedStems';
import { MAX_SEPARATION_DURATION, SEPARATION_COMPUTE_VERSION } from './separationModel';
import './panel.css';

export const ALL_STEMS: StemMix = { vocals: 1, drums: 1, bass: 1, other: 1 };

interface Props {
  kind: 'audio' | 'video' | null;
  state: PreparedStemsState;
  active: boolean;
  disabled: boolean;
  mix: StemMix;
  focus: DrumFocus;
  onPrepare: () => void;
  onCancel: () => void;
  onActivate: () => void;
  onOriginal: () => void;
  onMix: (mix: StemMix) => void;
  onFocus: (focus: DrumFocus) => void;
  onRemoveSaved: () => void;
  onOpen: () => void;
}

/** Fits the existing pad area. All download and processing are initiated by Prepare, never a tab change. */
export function StemsPanel({ kind, state, active, disabled, mix, focus, onPrepare, onCancel,
  onActivate, onOriginal, onMix, onFocus, onRemoveSaved, onOpen }: Props) {
  const [copied, setCopied] = useState(false);
  const memoryNoticeId = useId();
  useEffect(() => { setCopied(false); }, [state.failure]);
  const pads = [['vocals', 'Vocal'], ['other', 'Instruments'], ['bass', 'Bass'], ['drums', 'Drums']] as const;
  const copyFailure = (): void => {
    const details = JSON.stringify({ app: 'ClassTempo', startupFix: 'bounded-wasm-v2', browser: navigator.userAgent,
      separationFix: SEPARATION_COMPUTE_VERSION, crossOriginIsolated: globalThis.crossOriginIsolated, ...state.failure }, null, 2);
    const manual = (): void => { window.prompt('Copy these stems details', details); };
    if (!navigator.clipboard?.writeText) { manual(); return; }
    void navigator.clipboard.writeText(details).then(() => setCopied(true), manual);
  };
  const saveReport = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'ClassTempo', browser: navigator.userAgent,
      elapsedSeconds: state.seconds, stemsSaved: state.saved, ...state.report }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'classtempo-stems-report.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return <div className="stems-panel" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
    {!kind ? <div className="stems-intro">
      <strong>Hear each part of the song</strong><p>Open a song, then prepare vocals, drums, bass and instruments.</p>
      <button onClick={onOpen} disabled={disabled}>Open a song</button>
    </div> : kind === 'video' ? <div className="stems-intro" role="status">
      <strong>Stems work with songs</strong><p>Open an audio file to separate its parts. Video keeps its original sound.</p>
      <button onClick={onOpen} disabled={disabled}>Open a song</button>
    </div> : state.phase === 'working' ? <div className="stems-intro">
      <strong role="status">{state.message}</strong>
      <progress aria-label="Stem preparation" max={1} value={state.fraction ?? undefined} />
      <p>Keep ClassTempo open. Your song stays on this device.</p>
      <button onClick={onCancel}>Cancel preparation</button>
    </div> : state.phase === 'ready' ? <>
      <div className="stem-source"><span aria-live="polite">{active ? 'Stems on · tap a part to mute' : 'Original song'}</span>
        <button onClick={active ? onOriginal : onActivate} disabled={disabled}>{active ? 'Original' : 'Use stems'}</button></div>
      <div className="stem-pads" role="group" aria-label="Audible song parts">
        {pads.map(([key, label]) => <button key={key} aria-pressed={active && mix[key] > 0} disabled={disabled || !active}
          title={`${label}: tap to ${mix[key] ? 'mute' : 'hear'}`} onClick={() => onMix({ ...mix, [key]: active ? (mix[key] ? 0 : 1) : 1 })}>
          <span>{label}</span><small>{active && mix[key] > 0 ? 'On' : 'Off'}</small>
        </button>)}
        <button aria-pressed={active && mix.drums > 0 && focus === 'kick'} disabled={disabled || !active}
          title="Focus on low drum frequencies; this is a filter, not isolated kick separation"
          onClick={() => onFocus(focus === 'kick' ? 'full' : 'kick')}>Low drums<small>Kick range</small></button>
        <button aria-pressed={active && mix.drums > 0 && focus === 'hihat'} disabled={disabled || !active}
          title="Focus on high drum frequencies; this is a filter, not isolated hi-hat separation"
          onClick={() => onFocus(focus === 'hihat' ? 'full' : 'hihat')}>High drums<small>Hi-hat range</small></button>
      </div>
      <div className="stem-presets" role="group" aria-label="Stem shortcuts">
        <button disabled={disabled} onClick={() => { onFocus('full'); onMix({ vocals: 1, drums: 0, bass: 0, other: 0 }); }}>Acapella</button>
        <button disabled={disabled} onClick={() => { onFocus('full'); onMix({ vocals: 0, drums: 1, bass: 1, other: 1 }); }}>Instrumental</button>
        <button disabled={disabled} onClick={() => { onFocus('full'); onMix({ ...ALL_STEMS }); }}>All</button>
      </div>
      <details className="stem-details"><summary>Saved stems & details</summary>
        <p>{state.message} {state.seconds !== null && `Prepared in ${state.seconds.toFixed(1)}s.`}</p>
        <p>Low / High drums are frequency filters. Separation may leave audible artifacts.</p>
        {state.report && <button onClick={saveReport}>Save preparation report</button>}
        {state.saved && <button onClick={onRemoveSaved}>Remove saved stems</button>}
      </details>
    </> : <div className="stems-intro">
      <strong>Prepare stems</strong>
      {state.message && <p role={state.phase === 'error' ? 'alert' : 'status'}>{state.message}</p>}
      {state.failure && <button onClick={copyFailure}>{copied ? 'Details copied' : 'Copy details'}</button>}
      <p>Vocals, drums, bass and instruments. First use downloads an 80 MB engine plus its runtime. Best on Wi-Fi.</p>
      <div className="stems-memory-notice" id={memoryNoticeId}>
        <strong>Before using stems</strong>
        <p>Preparing and playing stems use extra memory. Low-memory devices may stop playback or close ClassTempo.
          Prepare before class and close unused apps.</p>
      </div>
      <button className="stems-prepare" aria-describedby={memoryNoticeId} disabled={disabled} onClick={onPrepare}>{state.phase === 'error' ? 'Try preparing again' : 'Prepare stems'}</button>
      <small>Stems limit: {MAX_SEPARATION_DURATION} per song · Keep app open</small>
      <a href={`${import.meta.env.BASE_URL}licenses/spleeter-stems.txt`} target="_blank" rel="noreferrer">Engine credits</a>
    </div>}
  </div>;
}
