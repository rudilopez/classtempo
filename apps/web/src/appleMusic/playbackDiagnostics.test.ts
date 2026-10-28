import { describe, expect, it, vi } from 'vitest';
import {
  createPlaybackDiagnosticsMonitor, MAX_PLAYBACK_EVENTS, readBufferDiagnostics,
  type DiagnosticMediaElement,
} from './playbackDiagnostics';

const ranges = (...values: Array<[number, number]>): TimeRanges => ({
  length: values.length,
  start: (index) => values[index]![0],
  end: (index) => values[index]![1],
});

class MediaElement extends EventTarget implements DiagnosticMediaElement {
  tagName = 'AUDIO';
  currentTime = 10;
  duration = 200;
  paused = false;
  muted = false;
  volume = 1;
  playbackRate = 0.75;
  readyState = 4;
  networkState = 2;
  seeking = false;
  buffered: TimeRanges | undefined = ranges([0, 40]);
  preservesPitch: boolean | undefined = true;
  webkitPreservesPitch: boolean | undefined;
}

describe('Apple Music buffer diagnostics', () => {
  it('uses the range containing playback, rather than counting unbuffered gaps', () => {
    const element = new MediaElement();
    element.buffered = ranges([0, 15], [30, 60]);
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBe(5);
    element.currentTime = 20;
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBe(0);
    element.currentTime = 45;
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBe(15);
    element.currentTime = 60;
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBe(0);
  });

  it('distinguishes an empty known buffer from missing, unreadable or invalid data', () => {
    const element = new MediaElement();
    element.buffered = ranges();
    expect(readBufferDiagnostics(element)).toMatchObject({ buffered: [], bufferedAheadSeconds: 0 });
    element.buffered = undefined;
    expect(readBufferDiagnostics(element)).toMatchObject({ buffered: null, bufferedAheadSeconds: null });
    element.buffered = ranges([5, 2]);
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBeNull();
    element.buffered = { length: 1, start: () => { throw new Error('range replaced'); }, end: () => 30 };
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBeNull();
    Object.defineProperty(element, 'buffered', { get: () => { throw new Error('unavailable'); } });
    expect(readBufferDiagnostics(element).bufferedAheadSeconds).toBeNull();
  });

  it('does not infer a known ahead value from an unknown playback position', () => {
    const element = new MediaElement();
    element.currentTime = Number.NaN;
    expect(readBufferDiagnostics(element)).toMatchObject({ buffered: [{ start: 0, end: 40 }], bufferedAheadSeconds: null });
  });

  it('bounds copied ranges while still finding playback beyond the copied range list', () => {
    const element = new MediaElement();
    element.buffered = ranges(...Array.from({ length: 12 }, (_, index): [number, number] => [index * 10, index * 10 + 5]));
    element.currentTime = 102;
    const result = readBufferDiagnostics(element);
    expect(result.buffered).toHaveLength(8);
    expect(result.bufferedRangesTruncated).toBe(true);
    expect(result.bufferedAheadSeconds).toBe(3);
  });
});

describe('Apple Music playback diagnostics monitor', () => {
  it('captures live native state and legacy pitch flags without inspecting private fields', () => {
    const element = new MediaElement();
    element.preservesPitch = undefined;
    element.webkitPreservesPitch = true;
    element.duration = Number.NaN;
    // Reading a source URL would violate the diagnostics privacy boundary.
    const source = vi.fn(() => { throw new Error('Do not read source URLs'); });
    Object.defineProperty(element, 'src', { get: source });
    const monitor = createPlaybackDiagnosticsMonitor(() => [element]);
    monitor.sync();
    expect(monitor.snapshot().media[0]).toMatchObject({
      elementId: 1, kind: 'audio', position: 10, duration: null, rate: 0.75,
      readyState: 4, networkState: 2, seeking: false, preservesPitch: true, bufferedAheadSeconds: 30,
    });
    element.buffered = ranges([0, 70]);
    element.currentTime = 20;
    expect(monitor.snapshot().media[0]?.bufferedAheadSeconds).toBe(50);
    expect(source).not.toHaveBeenCalled();
    monitor.dispose();
  });

  it('records each event once, replaces elements, and ignores events from detached elements', () => {
    const first = new MediaElement();
    const next = new MediaElement();
    let current = [first];
    let time = 1000;
    const monitor = createPlaybackDiagnosticsMonitor(() => current, () => time);
    monitor.sync();
    monitor.sync();
    time = 1500;
    first.dispatchEvent(new Event('waiting'));
    expect(monitor.snapshot().events).toEqual([{
      event: 'waiting', elementId: 1, elapsedMs: 500, position: 10,
      bufferedAheadSeconds: 30, readyState: 4, networkState: 2,
    }]);
    current = [next];
    first.dispatchEvent(new Event('stalled')); // Detached, before the observer refresh.
    monitor.sync();
    first.dispatchEvent(new Event('playing'));
    next.dispatchEvent(new Event('loadstart'));
    expect(monitor.snapshot().media.map((item) => item.elementId)).toEqual([2]);
    expect(monitor.snapshot().events.map((event) => event.event)).toEqual(['waiting', 'loadstart']);
    monitor.dispose();
    next.dispatchEvent(new Event('playing'));
    monitor.sync();
    expect(monitor.snapshot()).toEqual({ media: [], events: [] });
  });

  it('keeps recent history bounded and resets it for the next track', () => {
    const element = new MediaElement();
    let time = 0;
    const monitor = createPlaybackDiagnosticsMonitor(() => [element], () => time);
    monitor.sync();
    for (let index = 0; index < MAX_PLAYBACK_EVENTS + 10; index++) {
      time++;
      element.dispatchEvent(new Event('ratechange'));
    }
    expect(monitor.snapshot().events).toHaveLength(MAX_PLAYBACK_EVENTS);
    expect(monitor.snapshot().events[0]?.elapsedMs).toBe(11);
    const copied = monitor.snapshot();
    copied.events[0]!.position = 999;
    expect(monitor.snapshot().events[0]?.position).toBe(10);
    monitor.dispose();
    const nextTrack = createPlaybackDiagnosticsMonitor(() => [element], () => time);
    nextTrack.sync();
    expect(nextTrack.snapshot().events).toEqual([]);
    element.dispatchEvent(new Event('playing'));
    expect(nextTrack.snapshot().events[0]?.elapsedMs).toBe(0);
    nextTrack.dispose();
  });
});
