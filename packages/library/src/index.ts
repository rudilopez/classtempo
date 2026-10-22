/**
 * Phase 2 scaffold: the data model from docs/ARCHITECTURE.md. Storage lands in Phase 2
 * (IndexedDB via `idb` for records, OPFS for audio caches, File System Access handles for folders).
 */

export type SourceRef =
  | { kind: 'file'; name: string }
  | { kind: 'fsa-handle'; handleKey: string; path: string }
  | { kind: 'drive'; provider: 'google' | 'dropbox' | 'onedrive'; fileId: string };

export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  sampleRate: number;
  source: SourceRef;
  fileHash: string;
  addedAt: number;
}

export interface Analysis {
  trackId: string;
  version: number;
  bpm: number;
  firstBeat: number;
  /** absolute beat times for drifting-tempo tracks (Fluid Beatgrid parity) */
  beats?: Float64Array;
  key?: string;
  camelot?: string;
  loudnessLufs?: number;
  overview: Float32Array;
}

export interface CuePoints {
  trackId: string;
  hotCues: Array<{ time: number; name?: string; color?: string } | null>;
  loops: Array<{ start: number; end: number; name?: string } | null>;
}

export interface Crate {
  id: string;
  name: string;
  trackIds?: string[];
  smartQuery?: string;
}

export interface HistoryEntry {
  sessionId: string;
  playedAt: number;
  trackId: string;
  deck: number;
}

/** Interface every music source implements: local files, folder handles, cloud drives. */
export interface SourceProvider {
  readonly kind: SourceRef['kind'];
  list(): AsyncIterable<Track>;
  read(ref: SourceRef): Promise<Blob>;
}
