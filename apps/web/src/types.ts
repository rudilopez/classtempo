export interface TrackState {
  name: string;
  duration: number;
  bpm: number | null;
  firstBeat: number;
  peaks: Float32Array | null;
  analyzing: boolean;
}

export interface DeckUiState {
  track: TrackState | null;
  /** percent */
  pitch: number;
  playing: boolean;
  loop: { start: number; end: number } | null;
  loading: boolean;
}

export const initialDeckState: DeckUiState = {
  track: null,
  pitch: 0,
  playing: false,
  loop: null,
  loading: false,
};

export function effectiveBpm(s: DeckUiState): number | null {
  return s.track?.bpm ? s.track.bpm * (1 + s.pitch / 100) : null;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  const t = Math.floor((s % 1) * 10);
  return `${m}:${r.toString().padStart(2, '0')}.${t}`;
}
