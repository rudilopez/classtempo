import type { ReactNode, Ref } from 'react';
import brandLogo from '../assets/itda-logo-white.png';

/** Shared identity and transport for local files and subscription playback. */
export function Wordmark({ className }: { className: string }): React.ReactElement {
  return <span className={`${className} brand-wordmark`} role="img" aria-label="ClassTempo">
    <span className="brand-class" aria-hidden="true">Class</span><span className="brand-tempo" aria-hidden="true">Temp</span><img className="brand-mark" src={brandLogo} alt="" aria-hidden="true" />
  </span>;
}

export function NowPlayingLabel(): React.ReactElement {
  return <span className="dancer-track-kicker" role="img" aria-label="Now Playing">
    <span aria-hidden="true">N</span><img className="now-playing-logo" src={brandLogo} alt="" aria-hidden="true" /><span aria-hidden="true">W PLAYING</span>
  </span>;
}

interface TransportProps {
  playing: boolean;
  disabled: boolean;
  playDisabled?: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  onStage: () => void;
  stageRef?: Ref<HTMLButtonElement>;
  playLabel?: ReactNode;
  playDetail?: ReactNode;
  playClassName?: string;
  playTitle?: string;
  restartLabel?: string;
}

export function PlayerTransport({ playing, disabled, playDisabled = disabled, onTogglePlay, onRestart, onStage, stageRef,
  playLabel, playDetail, playClassName = '', playTitle = 'Space', restartLabel = 'Restart' }: TransportProps): React.ReactElement {
  return <div className="dancer-transport">
    <button className={`play ${playing ? 'on' : ''} ${playClassName}`} onClick={onTogglePlay} disabled={playDisabled} title={playTitle}>
      <span>{playLabel ?? (playing ? '❚❚ Pause' : '▶ Play')}</span>{playDetail && <small>{playDetail}</small>}
    </button>
    <button onClick={onRestart} disabled={disabled} title="Home">⟲ {restartLabel}</button>
    <button ref={stageRef} className="stage-open" onClick={onStage} disabled={disabled} title="Stage: full screen with play, restart and cue pads">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      </svg>Stage
    </button>
  </div>;
}
