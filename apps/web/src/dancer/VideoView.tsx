import { mediaErrorMessage } from '@mixdeck/engine';
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import './videoStatus.css';

interface Props {
  /**
   * The VideoDeck's `<video>`, or null to leave this view empty. There is only ever one element: it is moved
   * (appendChild) into whichever view gets it, so the waveform area hands it over to the Stage view and back
   * without a second decoder or a restart.
   */
  element: HTMLVideoElement | null;
  playing: boolean;
  /** Tapping the picture: play / pause. */
  onTap?: () => void;
  /** A failed source can be reopened paused, without selecting the file again. */
  onRetry?: () => void;
  /** User-initiated local diagnostic copy; never uploads the video. */
  onDetails?: () => void;
  className?: string;
  style?: CSSProperties;
  /** Presentation only: the same native video remains attached and playing. */
  mirrored?: boolean;
  zoom?: number;
}

interface VideoState {
  metadata: boolean;
  frame: boolean;
  buffering: boolean;
  error: string | null;
  errorCode: number | null;
}

function readState(element: HTMLVideoElement | null, buffering = false): VideoState {
  return {
    metadata: !!element && element.readyState >= 1,
    frame: !!element && element.readyState >= 2 && element.videoWidth > 0,
    buffering,
    error: element?.error ? mediaErrorMessage(element.error.code, element.getAttribute('aria-label') || 'video') : null,
    errorCode: element?.error?.code ?? null,
  };
}

/** Native video plus its actual readiness: metadata alone is not a decoded frame, especially on iOS. */
export function VideoView({ element, playing, onTap, onRetry, onDetails, className, style, mirrored = false, zoom = 1 }: Props) {
  const slot = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<VideoState>(() => readState(element));

  // Layout effect: the move happens in the same commit (and task) that unmounts the previous host, so the
  // browser never sees the element detached long enough to pause it.
  useLayoutEffect(() => {
    const host = slot.current;
    if (host && element && element.parentNode !== host) host.appendChild(element);
    setState(readState(element));
    if (!element) return;
    const update = (event: Event) => {
      const buffering = !element.paused && ['waiting', 'seeking'].includes(event.type);
      setState(readState(element, buffering));
    };
    const events = ['loadstart', 'emptied', 'loadedmetadata', 'loadeddata', 'canplay', 'playing', 'pause', 'resize', 'waiting', 'stalled', 'seeking', 'seeked', 'error'];
    for (const event of events) element.addEventListener(event, update);
    return () => {
      for (const event of events) element.removeEventListener(event, update);
    };
  }, [element]);

  const status = state.error
    ?? (!state.metadata ? 'Opening video…'
      : !state.frame ? (playing ? 'Loading video…' : 'Tap Play to show video')
        : state.buffering ? 'Loading video…' : null);
  const errorTitle = state.errorCode === 3 ? 'Video couldn’t be decoded'
    : state.errorCode === 4 ? 'Video format isn’t supported'
      : state.errorCode === 2 ? 'Video file couldn’t be read'
        : 'Video couldn’t play';
  const errorHint = state.errorCode === 3 ? 'Retry, or copy details to help diagnose it.'
    : state.errorCode === 4 ? 'Try MP4 · H.264 video + AAC audio.'
      : 'Import the file again.';

  return (
    <div
      className={`video-view${className ? ` ${className}` : ''}${state.error ? ' video-failed' : ''}`}
      style={style}
      onClick={state.error ? undefined : onTap}
      title={state.error ?? (onTap ? (playing ? 'Tap to pause' : 'Tap to play') : undefined)}
    >
      {/* the slot has no React children, so React never touches the element moved into it */}
      <div
        ref={slot}
        className="video-slot"
        style={{ transform: `scale(${Math.max(1, Math.min(2, zoom))}) scaleX(${mirrored ? -1 : 1})` }}
      />
      {element && status && (
        <span className="video-status" role={state.error ? 'alert' : 'status'}>
          {state.error ? <>
            <strong>{errorTitle}</strong><span>{errorHint}</span>
            {(onRetry || onDetails) && <span className="video-error-actions">
              {onRetry && <button type="button" onClick={(event) => { event.stopPropagation(); onRetry(); }}>Retry video</button>}
              {onDetails && <button type="button" onClick={(event) => { event.stopPropagation(); onDetails(); }}>Copy details</button>}
            </span>}
          </> : status}
        </span>
      )}
      {!playing && element && !status && (
        <span className="video-paused" aria-hidden="true">
          ▶
        </span>
      )}
    </div>
  );
}
