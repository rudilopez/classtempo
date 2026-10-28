import { clearMediaSession, setHandlers } from '../platform/mediaSession';

export interface SpotifyMediaSessionControls {
  isActive: () => boolean;
  play: () => void;
  pause: () => void;
  seek: (seconds: number) => void;
  restart: () => void;
}

/** Bind OS controls while Spotify owns the active player. Metadata is managed by the caller. */
export function bindSpotifyMediaSession(controls: SpotifyMediaSessionControls): () => void {
  let disposed = false;
  const active = () => !disposed && controls.isActive();
  setHandlers({
    play: () => { if (active()) controls.play(); },
    pause: () => { if (active()) controls.pause(); },
    stop: () => { if (active()) controls.pause(); },
    previoustrack: () => { if (active()) controls.restart(); },
    seekto: ({ seekTime }) => {
      if (active() && typeof seekTime === 'number' && Number.isFinite(seekTime) && seekTime >= 0) controls.seek(seekTime);
    },
  });
  return () => {
    if (disposed) return;
    disposed = true;
    clearMediaSession();
  };
}
