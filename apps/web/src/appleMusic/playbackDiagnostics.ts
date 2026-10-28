/** Read-only diagnostics for Apple's rendered media element; never inspect URLs or samples. */
export const APPLE_MEDIA_SELECTOR = 'audio#apple-music-player, video#apple-music-player';

export interface DiagnosticMediaElement extends EventTarget {
  readonly tagName: string;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly playbackRate: number;
  readonly readyState: number;
  readonly networkState: number;
  readonly seeking: boolean;
  readonly buffered?: TimeRanges;
  readonly preservesPitch?: boolean;
  readonly webkitPreservesPitch?: boolean;
}

export interface BufferDiagnostics {
  buffered: Array<{ start: number; end: number }> | null;
  bufferedRangesTruncated: boolean;
  bufferedAheadSeconds: number | null;
}

export interface MediaDiagnostics extends BufferDiagnostics {
  elementId: number;
  kind: string;
  position: number | null;
  duration: number | null;
  paused: boolean;
  muted: boolean;
  volume: number;
  rate: number;
  readyState: number;
  networkState: number;
  seeking: boolean;
  preservesPitch: boolean | null;
}

const OBSERVED_EVENTS = [
  'loadstart', 'loadedmetadata', 'loadeddata', 'emptied', 'waiting', 'stalled',
  'playing', 'pause', 'seeking', 'seeked', 'ratechange', 'canplay', 'canplaythrough', 'error',
] as const;
export const MAX_PLAYBACK_EVENTS = 32;
const MAX_REPORTED_RANGES = 8;

export interface PlaybackDiagnosticEvent {
  event: typeof OBSERVED_EVENTS[number];
  elementId: number;
  elapsedMs: number;
  position: number | null;
  bufferedAheadSeconds: number | null;
  readyState: number;
  networkState: number;
}

export interface PlaybackDiagnostics {
  media: MediaDiagnostics[];
  events: PlaybackDiagnosticEvent[];
}

const finite = (value: number): number | null => Number.isFinite(value) ? value : null;

/** A known empty buffer/gap is zero; unsupported, unreadable or invalid data stays unknown. */
export function readBufferDiagnostics(element: Pick<DiagnosticMediaElement, 'buffered' | 'currentTime'>): BufferDiagnostics {
  const unknown: BufferDiagnostics = { buffered: null, bufferedRangesTruncated: false, bufferedAheadSeconds: null };
  try {
    const buffered = element.buffered;
    if (!buffered) return unknown;
    const ranges: NonNullable<BufferDiagnostics['buffered']> = [];
    const position = finite(element.currentTime);
    let ahead = position === null ? null : 0;
    for (let index = 0; index < buffered.length; index++) {
      const start = buffered.start(index);
      const end = buffered.end(index);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return unknown;
      if (index < MAX_REPORTED_RANGES) ranges.push({ start, end });
      if (position !== null && start <= position && position <= end) ahead = end - position;
    }
    return { buffered: ranges, bufferedRangesTruncated: buffered.length > MAX_REPORTED_RANGES, bufferedAheadSeconds: ahead };
  } catch {
    return unknown;
  }
}

function readMedia(element: DiagnosticMediaElement, elementId: number): MediaDiagnostics {
  return {
    elementId, kind: element.tagName.toLowerCase(),
    position: finite(element.currentTime), duration: finite(element.duration),
    paused: element.paused, muted: element.muted, volume: element.volume,
    rate: element.playbackRate, readyState: element.readyState,
    networkState: element.networkState, seeking: element.seeking,
    preservesPitch: typeof element.preservesPitch === 'boolean' ? element.preservesPitch
      : typeof element.webkitPreservesPitch === 'boolean' ? element.webkitPreservesPitch : null,
    ...readBufferDiagnostics(element),
  };
}

export interface PlaybackDiagnosticsMonitor {
  sync: () => void;
  snapshot: () => PlaybackDiagnostics;
  dispose: () => void;
}

/** Call sync when Apple's element changes. Creating a fresh monitor starts a new track history. */
export function createPlaybackDiagnosticsMonitor(
  getElements: () => DiagnosticMediaElement[],
  now: () => number = () => performance.now(),
): PlaybackDiagnosticsMonitor {
  const started = now();
  const observed = new Map<DiagnosticMediaElement, { id: number; remove: () => void }>();
  const events: PlaybackDiagnosticEvent[] = [];
  let nextId = 1;
  let disposed = false;
  const sync = (): void => {
    if (disposed) return;
    const current = new Set(getElements());
    for (const [element, entry] of observed) {
      if (!current.has(element)) { entry.remove(); observed.delete(element); }
    }
    for (const element of current) {
      if (observed.has(element)) continue;
      const id = nextId++;
      const handlers = OBSERVED_EVENTS.map((event) => {
        const handler = (): void => {
          // A removed element can dispatch before the next mutation callback/poll.
          if (disposed || !getElements().includes(element)) return;
          events.push({
            event, elementId: id, elapsedMs: Math.round(now() - started),
            position: finite(element.currentTime),
            bufferedAheadSeconds: readBufferDiagnostics(element).bufferedAheadSeconds,
            readyState: element.readyState, networkState: element.networkState,
          });
          if (events.length > MAX_PLAYBACK_EVENTS) events.splice(0, events.length - MAX_PLAYBACK_EVENTS);
        };
        element.addEventListener(event, handler);
        return () => element.removeEventListener(event, handler);
      });
      observed.set(element, { id, remove: () => { for (const remove of handlers) remove(); } });
    }
  };
  return {
    sync,
    snapshot: () => ({
      media: Array.from(observed, ([element, entry]) => readMedia(element, entry.id)),
      events: events.map((event) => ({ ...event })),
    }),
    dispose: () => {
      disposed = true;
      for (const entry of observed.values()) entry.remove();
      observed.clear();
      events.length = 0;
    },
  };
}
