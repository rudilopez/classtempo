import './videoTools.css';

interface Props {
  mirrored: boolean;
  zoom: number;
  onMirroredChange: (mirrored: boolean) => void;
  onZoomChange: (zoom: number) => void;
}

/** Presentation controls only: mirroring and zoom never reload or copy the video. */
export function VideoTools({ mirrored, zoom, onMirroredChange, onZoomChange }: Props) {
  const nextZoom = zoom < 1.5 ? 1.5 : zoom < 2 ? 2 : 1;
  return (
    <div className="video-tools" role="group" aria-label="Video view">
      <button
        type="button"
        className={mirrored ? 'on' : ''}
        aria-pressed={mirrored}
        onClick={() => onMirroredChange(!mirrored)}
        title="Mirror the picture horizontally"
      >
        Mirror
      </button>
      <button
        type="button"
        onClick={() => onZoomChange(nextZoom)}
        aria-label={`Video zoom ${zoom} times. Change to ${nextZoom} times`}
        title={nextZoom === 1 ? 'Show the full picture' : `Zoom to ${nextZoom}×`}
      >
        {zoom === 1 ? 'Fit' : `${zoom}×`}
      </button>
    </div>
  );
}
