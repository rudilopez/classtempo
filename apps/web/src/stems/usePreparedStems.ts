import { useEffect, useRef, useState } from 'react';
import type { Engine, StemDeck } from '@mixdeck/engine';
import { loadStemCache, removeStemCache, saveStemCache, stemCacheKey } from './cache';
import {
  MAX_SEPARATION_SECONDS, SEPARATION_MODEL_VERSION,
  type SeparationInput, type SeparationMessage, type SeparationReport,
} from './separationModel';

export interface PreparedStemsState {
  phase: 'idle' | 'working' | 'ready' | 'error';
  message: string;
  fraction: number | null;
  saved: boolean;
  seconds: number | null;
  report?: SeparationReport;
}

const idle = (): PreparedStemsState => ({ phase: 'idle', message: '', fraction: null, saved: false, seconds: null });
const aborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
};

/** Resample one stereo pair at a time, bounding the extra phone memory during rate conversion. */
async function resample(channels: Float32Array[], sourceRate: number, targetRate: number, signal: AbortSignal): Promise<Float32Array[]> {
  if (sourceRate === targetRate) return channels;
  const sourceLength = channels[0]!.length;
  const length = Math.round(sourceLength * targetRate / sourceRate);
  for (let pair = 0; pair < 4; pair++) {
    aborted(signal);
    const context = new OfflineAudioContext(2, length, targetRate);
    const sourceBuffer = context.createBuffer(2, sourceLength, sourceRate);
    sourceBuffer.copyToChannel(channels[pair * 2]! as Float32Array<ArrayBuffer>, 0);
    sourceBuffer.copyToChannel(channels[pair * 2 + 1]! as Float32Array<ArrayBuffer>, 1);
    const node = context.createBufferSource();
    node.buffer = sourceBuffer;
    node.connect(context.destination);
    node.start();
    const rendered = await context.startRendering();
    aborted(signal);
    channels[pair * 2] = rendered.getChannelData(0);
    channels[pair * 2 + 1] = rendered.getChannelData(1);
  }
  return channels;
}

/** Explicit preparation only: selecting the Stems pill never starts a download or separation. */
export function usePreparedStems(engine: Engine, file: File | null, trackId: number | null, duration: number) {
  const [state, setState] = useState<PreparedStemsState>(idle);
  const deck = useRef<StemDeck | null>(null);
  const worker = useRef<Worker | null>(null);
  const abort = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const cacheKey = useRef<string | null>(null);

  const stop = (): void => {
    sequence.current++;
    abort.current?.abort();
    abort.current = null;
    worker.current?.terminate();
    worker.current = null;
  };
  const reset = (): void => {
    stop();
    deck.current?.unload();
    deck.current = null;
    cacheKey.current = null;
    setState(idle());
  };
  useEffect(() => { reset(); }, [file, trackId]);
  useEffect(() => () => { stop(); deck.current?.release(); }, []);

  const cancel = (): void => {
    stop();
    deck.current?.unload();
    deck.current = null;
    setState({ ...idle(), message: 'Preparation cancelled. The original song is unchanged.' });
  };

  const prepare = async (): Promise<void> => {
    if (!file || abort.current || state.phase === 'working' || state.phase === 'ready') return;
    stop();
    const token = sequence.current;
    const controller = new AbortController();
    abort.current = controller;
    const signal = controller.signal;
    const started = performance.now();
    const update = (message: string, fraction: number | null = null): void => {
      if (sequence.current === token) setState({ phase: 'working', message, fraction, saved: false, seconds: null });
    };
    try {
      if (duration > MAX_SEPARATION_SECONDS || file.size > 100 * 1024 * 1024) {
        throw new Error(`Choose a song up to ${MAX_SEPARATION_SECONDS / 60} minutes and 100 MB for stems.`);
      }
      update('Checking saved stems…');
      const key = await stemCacheKey(file, SEPARATION_MODEL_VERSION, signal);
      aborted(signal);
      cacheKey.current = key;
      let cached = await loadStemCache(key, signal).catch((error: unknown) => {
        aborted(signal);
        console.warn('Saved stems could not be read', error);
        return null;
      });
      aborted(signal);
      let saved = !!cached;
      let saveReason = '';
      let report: SeparationReport | undefined;
      if (!cached) {
        update('Reading the song on this device…');
        const context = new OfflineAudioContext(2, 1, 44_100);
        const sourceBytes = await file.arrayBuffer();
        aborted(signal);
        const audio = await context.decodeAudioData(sourceBytes);
        aborted(signal);
        if (audio.duration > MAX_SEPARATION_SECONDS || audio.length < 1) throw new Error('This song is too long for on-device stems.');
        const channels: [Float32Array, Float32Array] = [
          audio.getChannelData(0).slice(),
          audio.getChannelData(Math.min(1, audio.numberOfChannels - 1)).slice(),
        ];
        const result = await new Promise<Extract<SeparationMessage, { type: 'complete' }>>((resolve, reject) => {
          const next = new Worker(new URL('./separate.worker.ts', import.meta.url), { type: 'module' });
          worker.current = next;
          const finish = (): void => { next.terminate(); if (worker.current === next) worker.current = null; signal.removeEventListener('abort', onAbort); };
          const onAbort = (): void => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
          signal.addEventListener('abort', onAbort, { once: true });
          next.onerror = (event) => { finish(); reject(new Error(event.message || 'Stem preparation stopped. Try a shorter song.')); };
          next.onmessage = (event: MessageEvent<SeparationMessage>) => {
            if (signal.aborted || sequence.current !== token) return;
            const message = event.data;
            if (message.type === 'progress') update(message.stage, message.fraction);
            else if (message.type === 'error') { finish(); reject(new Error(message.message)); }
            else { finish(); resolve(message); }
          };
          next.postMessage({ type: 'separate', channels, sampleRate: 44_100, provider: 'auto' } satisfies SeparationInput,
            channels.map((channel) => channel.buffer));
        });
        aborted(signal);
        report = result.report;
        update('Saving stems on this device…');
        const stored = await saveStemCache(key, result.stems, result.sampleRate, signal);
        aborted(signal);
        saved = stored.saved;
        saveReason = stored.reason ?? '';
        cached = { channels: result.stems, sampleRate: result.sampleRate, frameCount: result.stems[0]!.length };
      }
      update('Preparing synchronized playback…');
      const channels = await resample(cached.channels, cached.sampleRate, engine.ctx.sampleRate, signal);
      aborted(signal);
      const next = await engine.getStemDeck();
      aborted(signal);
      deck.current = next;
      await next.loadChannels({ sampleRate: engine.ctx.sampleRate, vocals: [channels[0]!, channels[1]!],
        drums: [channels[2]!, channels[3]!], bass: [channels[4]!, channels[5]!], other: [channels[6]!, channels[7]!] }, file.name, { transfer: true });
      if (signal.aborted || sequence.current !== token) return;
      next.setMix({ vocals: 1, drums: 1, bass: 1, other: 1 });
      next.setDrumFocus('full');
      abort.current = null;
      const storageMessage = saved ? 'Saved on this device.' : `Ready for this session. ${saveReason || 'Could not save on this device.'}`;
      const engineMessage = report && !report.modelCached ? ' The engine could not be cached; preparing another song may need internet.' : '';
      setState({ phase: 'ready', message: storageMessage + engineMessage,
        fraction: 1, saved, seconds: (performance.now() - started) / 1000, report });
    } catch (error) {
      if (sequence.current !== token || signal.aborted) return;
      stop();
      deck.current?.unload();
      deck.current = null;
      setState({ ...idle(), phase: 'error', message: error instanceof Error ? error.message : 'Could not prepare stems. The original song is available.' });
    }
  };

  const removeSaved = async (): Promise<void> => {
    if (!cacheKey.current) return;
    const token = sequence.current;
    try {
      await removeStemCache(cacheKey.current);
      if (sequence.current === token) setState((previous) => ({ ...previous, saved: false, message: 'Saved stems removed. Still available until you open another song.' }));
    } catch {
      if (sequence.current === token) setState((previous) => ({ ...previous, message: 'Saved stems could not be removed. Try again.' }));
    }
  };

  return { state, deck, prepare, cancel, reset, removeSaved };
}
