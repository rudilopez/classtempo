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
  // Work in whole tenths so exact cue values such as 1.2 do not display as 1.1.
  const tenths = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10 + 1e-7);
  const m = Math.floor(tenths / 600);
  const r = Math.floor(tenths / 10) % 60;
  const t = tenths % 10;
  return `${m}:${r.toString().padStart(2, '0')}.${t}`;
}
