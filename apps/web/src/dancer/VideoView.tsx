import { useLayoutEffect, useRef, type CSSProperties } from 'react';

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
  className?: string;
  style?: CSSProperties;
}

/** Black, letterboxed (object-fit: contain) video frame with a ▶ badge while paused. */
export function VideoView({ element, playing, onTap, className, style }: Props) {
  const slot = useRef<HTMLDivElement>(null);

  // Layout effect: the move happens in the same commit (and task) that unmounts the previous host, so the
  // browser never sees the element detached long enough to pause it.
  useLayoutEffect(() => {
    const host = slot.current;
    if (host && element && element.parentNode !== host) host.appendChild(element);
  }, [element]);

  return (
    <div
      className={className ? `video-view ${className}` : 'video-view'}
      style={style}
      onClick={onTap}
      title={onTap ? (playing ? 'Tap to pause' : 'Tap to play') : undefined}
    >
      {/* the slot has no React children, so React never touches the element moved into it */}
      <div ref={slot} className="video-slot" />
      {!playing && element && (
        <span className="video-paused" aria-hidden="true">
          ▶
        </span>
      )}
    </div>
  );
}
