import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatTime } from '../types';
import { padColor } from './CuePads';
import type { CueSlots } from './cueStore';
import { VideoView } from './VideoView';

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
  cues: CueSlots;
  /** Name of the cue section the playhead is in; null before the first cue. */
  section: string | null;
  onTogglePlay: () => void;
  onRestart: () => void;
  /** Launches pad `index` (only set pads are shown). */
  onLaunch: (index: number) => void;
  onClose: () => void;
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
 * Stage view: a full-viewport performance screen with only the video (or, without one, the current cue section
 * and elapsed time in large type), Play / Pause, Restart, and the set cue pads as launch-only buttons. No tempo,
 * no editing, no loading. Rendered into <body> above the app; audio recovery portals into this root while it owns
 * full screen, so its resume button stays reachable. Full screen is left again when Stage closes. Escape, or
 * leaving full screen (Esc, Android back), closes it.
 */
export function StageView({ video, aspect, title, playing, position, cues, section, onTogglePlay, onRestart, onLaunch, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

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
        close.current();
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
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const pads = cues.flatMap((cue, index) => (cue ? [{ cue, index }] : []));

  return createPortal(
    <div
      ref={root}
      className={`stage ${video ? 'stage-has-video' : 'stage-no-video'}`}
      style={aspect ? { ['--video-ar' as string]: String(aspect) } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Stage view"
      tabIndex={-1}
    >
      <div className="stage-screen">
        {video ? (
          <VideoView element={video} playing={playing} onTap={onTogglePlay} className="stage-video" />
        ) : (
          <div className="stage-now" aria-live="polite">
            <span className="stage-title">{title}</span>
            <span className="stage-section">{section ?? 'Start'}</span>
            <span className="stage-time">{formatTime(position)}</span>
          </div>
        )}
      </div>
      <div className="stage-bar">
        <div className="stage-transport">
          <button className={`stage-play ${playing ? 'on' : ''}`} onClick={onTogglePlay} title="Space">
            {playing ? '❚❚  Pause' : '▶  Play'}
          </button>
          <button className="stage-restart" onClick={onRestart} title="Home">
            ⟲ Restart
          </button>
        </div>
        {pads.length > 0 ? (
          <div className="stage-pads">
            {pads.map(({ cue, index }) => (
              <button
                key={index}
                className="stage-pad"
                style={{ ['--pad' as string]: padColor(index) }}
                onClick={() => onLaunch(index)}
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
      </div>
      <button className="stage-exit" onClick={onClose} aria-label="Exit Stage view" title="Exit (Esc)">
        ✕
      </button>
    </div>,
    document.body,
  );
}
