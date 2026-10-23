import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatTime } from '../types';
import { padColor } from './CuePads';
import type { CueSlots } from './cueStore';
import { clampTempo, TEMPO_MAX, TEMPO_MIN } from './TempoControl';
import { VideoTools } from './VideoTools';
import { VideoView } from './VideoView';
import { VideoTimeline } from './VideoTimeline';
import './stageClassroom.css';
import './stageVideo.css';

interface Props {
  /** The VideoDeck's element when a video with a picture is loaded; it is moved in here while Stage is open. */
  video: HTMLVideoElement | null;
  /** The video's width / height (lays the picture out at full width on top in portrait). */
  aspect: number | null;
  /** Song name, shown small above the cue section when there is no video. */
  title: string;
  playing: boolean;
  /** Elapsed seconds (the 10 Hz display position). */
  position: number;
  duration?: number;
  practiceRange?: { start: number; end: number };
  onSeek?: (position: number) => void;
  onOpenPractice?: () => void;
  cues: CueSlots;
  /** Name of the cue section the playhead is in; null before the first cue. */
  section: string | null;
  onTogglePlay: () => void;
  onRestart: () => void;
  /** Launches pad `index` (only set pads are shown). */
  onLaunch: (index: number) => void;
  onClose: () => void;
  tempo?: number;
  onTempoChange?: (percent: number) => void;
  mirrored?: boolean;
  zoom?: number;
  onMirroredChange?: (mirrored: boolean) => void;
  onZoomChange?: (zoom: number) => void;
  onRestartSection?: () => void;
  practiceName?: string;
  onEndPractice?: () => void;
  pendingLabel?: string | null;
  talking?: boolean;
  onToggleTalk?: () => void;
  onRetryVideo?: () => void;
  onVideoDetails?: () => void;
}

/** Element and document full-screen API, unprefixed or with the older WebKit prefix (iPadOS before 16.4). */
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };
type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };

function currentFullscreen(): Element | null {
  const d = document as FullscreenDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Overlays that already asked: a request consumes the tap's user activation, so a second one (StrictMode's dev-only
 * effect re-run on the same element) would only fail.
 */
const requested = new WeakSet<Element>();

/** Asks for full screen where the element API exists (iPad, Android, desktop); iPhone Safari has none. Never throws. */
function enterFullscreen(el: FullscreenElement): void {
  if (requested.has(el)) return;
  requested.add(el);
  try {
    if (typeof el.requestFullscreen === 'function') void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    // Refused (no user activation, or not allowed here): the overlay still covers the viewport.
  }
}

function exitFullscreen(): void {
  const d = document as FullscreenDocument;
  try {
    if (typeof d.exitFullscreen === 'function') void d.exitFullscreen().catch(() => {});
    else d.webkitExitFullscreen?.();
  } catch {
    // Already left.
  }
}

/**
 * Stage view: a full-viewport teaching screen with the video or current section, essential playback and tempo
 * controls, and the set cue pads as launch-only buttons. Rendered into <body> above the app; recovery portals into this root while it owns
 * full screen, so its resume button stays reachable. Full screen is left again when Stage closes. Escape, or
 * leaving full screen (Esc, Android back), closes it.
 */
export function StageView({
  video, aspect, title, playing, position, cues, section, onTogglePlay, onRestart, onLaunch, onClose,
  duration = 0, practiceRange, onSeek, onOpenPractice,
  tempo = 100, onTempoChange, mirrored = false, zoom = 1, onMirroredChange, onZoomChange,
  onRestartSection, practiceName, onEndPractice, pendingLabel, talking = false, onToggleTalk, onRetryVideo, onVideoDetails,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [tray, setTray] = useState<'cues' | 'tools' | null>(null);
  const activeTray = useRef(tray);
  activeTray.current = tray;
  const cuesTrigger = useRef<HTMLButtonElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const trayRoot = useRef<HTMLDivElement>(null);
  const [videoFailed, setVideoFailed] = useState(!!video?.error);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useLayoutEffect(() => {
    const update = () => setVideoFailed(!!video?.error);
    update();
    for (const event of ['error', 'loadstart', 'emptied']) video?.addEventListener(event, update);
    return () => {
      for (const event of ['error', 'loadstart', 'emptied']) video?.removeEventListener(event, update);
    };
  }, [video]);

  // a layout effect so the request runs in the commit of the tap that opened Stage (it needs that user activation)
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const app = document.querySelector<HTMLElement>('.app');
    const previouslyInert = app?.inert ?? false;
    if (app) app.inert = true;
    // The recovery button is portaled alongside Stage when fullscreen is unavailable. It must remain usable.
    const focusable = () => {
      const recovery = document.querySelector<HTMLButtonElement>('.resume-audio');
      if (recovery) return [recovery];
      return [...el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
        .filter((item) => item.getClientRects().length > 0 && !item.closest('[hidden], [inert]'));
    };
    const onTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      const items = focusable();
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey ? (current <= 0 ? items.length - 1 : current - 1) : (current + 1) % items.length;
      (items[next] ?? el).focus({ preventScroll: true });
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || el.contains(target)) return;
      const items = focusable();
      if (items.some((item) => item.contains(target))) return;
      (items[0] ?? el).focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onTab, true);
    document.addEventListener('focusin', onFocus);
    let entered = false;
    const onChange = () => {
      if (currentFullscreen() === el) entered = true;
      else if (entered) {
        entered = false;
        // Some browsers consume Escape for native fullscreen before sending a DOM key event. Dismiss
        // an open tray first and keep Stage as a viewport overlay; a subsequent Exit/Escape closes it.
        if (activeTray.current) {
          const trigger = activeTray.current === 'cues' ? cuesTrigger.current : toolsTrigger.current;
          setTray(null);
          trigger?.focus({ preventScroll: true });
        } else close.current();
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    enterFullscreen(el);
    el.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      document.removeEventListener('keydown', onTab, true);
      document.removeEventListener('focusin', onFocus);
      if (app) app.inert = previouslyInert;
      if (currentFullscreen() === el) exitFullscreen();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (video || e.key !== 'Escape') return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [video]);

  useLayoutEffect(() => {
    if (tray) trayRoot.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [tray]);

  const closeTray = () => {
    const trigger = tray === 'cues' ? cuesTrigger.current : toolsTrigger.current;
    setTray(null);
    trigger?.focus({ preventScroll: true });
  };

  const pads = cues.flatMap((cue, index) => (cue ? [{ cue, index }] : []));

  return createPortal(
    <div
      ref={root}
      className={`stage stage-classroom ${video ? 'stage-has-video' : 'stage-no-video'}`}
      style={aspect ? { ['--video-ar' as string]: String(aspect) } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Stage view"
      tabIndex={-1}
      onKeyDown={video ? (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (tray) closeTray();
          else onClose();
        } else if (event.target instanceof Element && event.target.closest('button, input, select')) {
          // Let the focused control handle Space and arrows instead of the global player shortcuts.
          event.stopPropagation();
        }
      } : undefined}
      onKeyUp={video ? (event) => {
        if (event.target instanceof Element && event.target.closest('button, input, select')) event.stopPropagation();
      } : undefined}
    >
      <div className="stage-screen">
        {video ? (
          <VideoView element={video} playing={playing} onTap={onTogglePlay} mirrored={mirrored} zoom={zoom} className="stage-video" onRetry={onRetryVideo} onDetails={onVideoDetails} />
        ) : (
          <div className="stage-now" aria-live="polite">
            <span className="stage-title">{title}</span>
            <span className="stage-section">{section ?? 'Start'}</span>
            <span className="stage-time">{formatTime(position)}</span>
          </div>
        )}
        {pendingLabel && <div className="stage-pending" role="status">{pendingLabel}</div>}
        {video && tray && <div ref={trayRoot} id={`stage-${tray}-tray`} className="stage-video-tray" role="region" aria-label={tray === 'cues' ? 'Cue controls' : 'Video tools'}>
          <div className="stage-video-tray-header">
            <strong>{tray === 'cues' ? 'Cues' : 'Video tools'}</strong>
            <button type="button" onClick={closeTray} aria-label={`Close ${tray === 'cues' ? 'cues' : 'tools'}`}>✕</button>
          </div>
          <div className="stage-video-tray-body">
            {tray === 'cues' ? pads.length > 0 ? <div className="stage-pads">
              {pads.map(({ cue, index }) => <button key={index} className="stage-pad" style={{ ['--pad' as string]: padColor(index) }} onClick={() => onLaunch(index)} disabled={videoFailed} title={`Launch ${cue.name} (key ${index + 1})`}>
                <span className="stage-pad-key">{index + 1}</span>
                <span className="stage-pad-name">{cue.name}</span>
              </button>)}
            </div> : <p className="stage-hint">No cues yet. Exit Stage, open Cues, then tap an empty pad to set one.</p> : <>
              {onTempoChange && <div className="stage-video-tool-row">
                <span>Tempo</span>
                <div className="stage-tempo" role="group" aria-label="Tempo">
                  <button onClick={() => onTempoChange(clampTempo(tempo - 1))} disabled={videoFailed || tempo <= TEMPO_MIN} aria-label="Decrease tempo by 1 percent">−</button>
                  <button className="stage-tempo-value" onClick={() => onTempoChange(100)} disabled={videoFailed} aria-label={`Tempo ${tempo} percent. Reset to 100 percent`} title="Reset to original tempo">{tempo}%</button>
                  <button onClick={() => onTempoChange(clampTempo(tempo + 1))} disabled={videoFailed || tempo >= TEMPO_MAX} aria-label="Increase tempo by 1 percent">+</button>
                </div>
              </div>}
              <div className="stage-video-tool-actions">
                <button onClick={onRestartSection ?? onRestart} disabled={videoFailed} aria-label={onRestartSection ? 'Restart section' : 'Restart video'}>⟲ {onRestartSection ? 'Section' : 'Restart'}</button>
                {onToggleTalk && <button className={talking ? 'on' : ''} onClick={onToggleTalk} disabled={videoFailed} aria-pressed={talking} title="Pause video while you speak">Talk</button>}
                {!videoFailed && onMirroredChange && onZoomChange && <VideoTools mirrored={mirrored} zoom={zoom} onMirroredChange={onMirroredChange} onZoomChange={onZoomChange} />}
              </div>
            </>}
          </div>
        </div>}
      </div>
      {video ? <div className="stage-video-controls">
        {onEndPractice && <div className="stage-practice">
          <span title={practiceName}>Practice · {practiceName}</span>
          <button onClick={onEndPractice}>End practice</button>
        </div>}
        {onSeek && <VideoTimeline position={position} duration={duration} cues={cues} practiceRange={practiceRange} onSeek={onSeek} disabled={videoFailed} />}
        <div className="stage-video-dock" aria-label="Video playback controls">
          <button className={`stage-play ${playing ? 'on' : ''}`} onClick={onTogglePlay} disabled={videoFailed} aria-label={videoFailed ? 'Video unavailable' : pendingLabel ? 'Cancel playback countdown' : playing ? 'Pause' : 'Play'}>
            {videoFailed ? 'Error' : pendingLabel ? 'Cancel' : playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button ref={cuesTrigger} className={tray === 'cues' ? 'on' : ''} aria-expanded={tray === 'cues'} aria-controls="stage-cues-tray" onClick={() => tray === 'cues' ? closeTray() : setTray('cues')}>Cues</button>
          <button onClick={onOpenPractice} disabled={!onOpenPractice || videoFailed}>Practice</button>
          <button ref={toolsTrigger} className={`stage-tools-toggle ${tray === 'tools' ? 'on' : ''}`} aria-label="Tools" aria-expanded={tray === 'tools'} aria-controls="stage-tools-tray" onClick={() => tray === 'tools' ? closeTray() : setTray('tools')}><span>Tools</span><small>{tempo}%</small></button>
          <button onClick={onClose} aria-label="Exit Stage view" title="Exit Stage (Esc)">Exit</button>
        </div>
      </div> : <div className="stage-bar">
        <div className="stage-controls">
          {onEndPractice && <div className="stage-practice">
            <span title={practiceName}>Practice · {practiceName}</span>
            <button onClick={onEndPractice}>End practice</button>
          </div>}
          <div className={`stage-transport ${onToggleTalk ? 'stage-with-talk' : ''}`}>
            <button className={`stage-play ${playing ? 'on' : ''}`} onClick={onTogglePlay} disabled={videoFailed} title="Space">
              {videoFailed ? 'Unavailable' : pendingLabel ? '✕ Cancel' : playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <button
              className="stage-restart"
              onClick={onRestartSection ?? onRestart}
              title="Home"
              aria-label={onRestartSection ? 'Restart section' : 'Restart song'}
              disabled={videoFailed}
            >
              ⟲ {onRestartSection ? 'Section' : 'Restart'}
            </button>
            {onToggleTalk && (
              <button className={`stage-talk ${talking ? 'on' : ''}`} onClick={onToggleTalk} disabled={videoFailed} aria-pressed={talking} title="Lower music while you speak">
                Talk
              </button>
            )}
          </div>
          {(onTempoChange || (video && onMirroredChange && onZoomChange)) && (
            <div className="stage-options">
              {onTempoChange && (
                <div className="stage-tempo" role="group" aria-label="Tempo">
                  <button onClick={() => onTempoChange(clampTempo(tempo - 1))} disabled={videoFailed || tempo <= TEMPO_MIN} aria-label="Decrease tempo by 1 percent">−</button>
                  <button className="stage-tempo-value" onClick={() => onTempoChange(100)} disabled={videoFailed} aria-label={`Tempo ${tempo} percent. Reset to 100 percent`} title="Reset to original tempo">{tempo}%</button>
                  <button onClick={() => onTempoChange(clampTempo(tempo + 1))} disabled={videoFailed || tempo >= TEMPO_MAX} aria-label="Increase tempo by 1 percent">+</button>
                </div>
              )}
              {video && !videoFailed && onMirroredChange && onZoomChange && (
                <VideoTools mirrored={mirrored} zoom={zoom} onMirroredChange={onMirroredChange} onZoomChange={onZoomChange} />
              )}
            </div>
          )}
        </div>
        {pads.length > 0 ? (
          <div className="stage-pads">
            {pads.map(({ cue, index }) => (
              <button
                key={index}
                className="stage-pad"
                style={{ ['--pad' as string]: padColor(index) }}
                onClick={() => onLaunch(index)}
                disabled={videoFailed}
                title={`Launch ${cue.name} (key ${index + 1})`}
              >
                <span className="stage-pad-key">{index + 1}</span>
                <span className="stage-pad-name">{cue.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="stage-hint">Set cues first</p>
        )}
      </div>}
      {!video && <button className="stage-exit" onClick={onClose} aria-label="Exit Stage view" title="Exit (Esc)">
        ✕
      </button>}
    </div>,
    document.body,
  );
}
