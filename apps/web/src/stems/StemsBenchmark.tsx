import { useEffect, useRef, useState } from 'react';
import {
  SAMPLE_RATE, STEM_MODEL, STEM_NAMES,
  type BenchmarkInput, type BenchmarkMessage, type BenchmarkReport, type ProviderPreference,
} from './model';
import './stems.css';
import modelNotice from './NOTICE.txt?raw';
import { loadDiagnostic, saveDiagnostic, type RunDiagnostic } from './diagnostics';

interface SavedReport extends BenchmarkReport {
  createdAt: string;
  userAgent: string;
  requestedSeconds: number;
  decodeMs: number;
  pageElapsedMs: number;
  totalPeakMemory: 'unavailable';
  memoryNote: string;
  benchmarkScope: string;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
const mib = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** Local stereo WAV used only for the short listening previews; songs are never uploaded. */
function previewWav(left: Float32Array, right: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + left.length * 4);
  const view = new DataView(buffer);
  const text = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, left.length * 4, true);
  for (let i = 0; i < left.length; i++) {
    view.setInt16(44 + i * 4, Math.round(Math.max(-1, Math.min(1, left[i]!)) * 32767), true);
    view.setInt16(46 + i * 4, Math.round(Math.max(-1, Math.min(1, right[i]!)) * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export default function StemsLab(): React.ReactElement {
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<30 | 240>(30);
  const [provider, setProvider] = useState<ProviderPreference>('auto');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('Choose an audio file, then run the 30-second test first.');
  const [fraction, setFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [diagnostic, setDiagnostic] = useState<RunDiagnostic | null>(loadDiagnostic);
  const worker = useRef<Worker | null>(null);
  const generation = useRef(0);
  const started = useRef(0);
  const lastDiagnosticUpdate = useRef(0);

  const record = (status: RunDiagnostic['status'], message: string, failure: string | null = null): void => {
    const value: RunDiagnostic = {
      schema: 1, status, stage: message, error: failure,
      updatedAt: new Date().toISOString(),
      elapsedMs: performance.now() - started.current,
      requestedSeconds: duration,
      providerPreference: provider,
      userAgent: navigator.userAgent,
    };
    saveDiagnostic(value); setDiagnostic(value); lastDiagnosticUpdate.current = performance.now();
  };

  useEffect(() => () => {
    generation.current++;
    worker.current?.terminate();
  }, []);
  useEffect(() => () => { previewUrls.forEach((url) => URL.revokeObjectURL(url)); }, [previewUrls]);
  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => setElapsed(performance.now() - started.current), 250);
    return () => window.clearInterval(interval);
  }, [running]);

  const cancel = (): void => {
    generation.current++;
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setStage('Cancelled. No benchmark result was recorded.');
    setFraction(null);
    record('cancelled', 'Cancelled by the user');
  };

  const run = async (): Promise<void> => {
    if (!file || running) return;
    const token = ++generation.current;
    started.current = performance.now();
    setElapsed(0); setRunning(true); setError(null); setReport(null); setPreviewUrls([]); setFraction(null);
    setStage('Decoding audio locally at 44.1 kHz…');
    record('running', 'Decoding audio locally at 44.1 kHz');
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('For this phone benchmark, choose an audio file smaller than 100 MB.');
      // Offline decoding avoids opening a live playback context and resamples to the exact model rate.
      const context = new OfflineAudioContext(2, 1, SAMPLE_RATE);
      const source = await context.decodeAudioData(await file.arrayBuffer());
      if (generation.current !== token) return;
      const length = Math.min(source.length, duration * SAMPLE_RATE);
      if (length < SAMPLE_RATE) throw new Error('Choose an audio file at least one second long.');
      const channels: [Float32Array, Float32Array] = [
        source.getChannelData(0).slice(0, length),
        source.getChannelData(Math.min(1, source.numberOfChannels - 1)).slice(0, length),
      ];
      const decodeMs = performance.now() - started.current;
      const next = new Worker(new URL('./stems.worker.ts', import.meta.url), { type: 'module' });
      worker.current = next;
      const fail = (message: string): void => {
        if (generation.current !== token) return;
        next.terminate(); worker.current = null; setRunning(false); setError(message);
        setStage('Benchmark did not complete. This is not a passing result.'); setFraction(null);
        record('failed', 'Benchmark failed', message);
      };
      next.onerror = (event) => fail(event.message || 'The inference worker stopped unexpectedly. Try a smaller clip or report this failure.');
      next.onmessage = (event: MessageEvent<BenchmarkMessage>) => {
        if (generation.current !== token) return;
        const message = event.data;
        if (message.type === 'progress') {
          setStage(message.stage); setFraction(message.fraction);
          if (performance.now() - lastDiagnosticUpdate.current > 500) record('running', message.stage);
          return;
        }
        if (message.type === 'error') { fail(message.message); return; }
        const saved: SavedReport = {
          ...message.report,
          createdAt: new Date().toISOString(),
          userAgent: navigator.userAgent,
          requestedSeconds: duration,
          decodeMs,
          pageElapsedMs: performance.now() - started.current,
          totalPeakMemory: 'unavailable',
          memoryNote: 'Browsers do not expose reliable combined page, worker, WASM and GPU peak memory. Worker JS heap is optional and incomplete; owned PCM is a size estimate, not a measured peak.',
          benchmarkScope: 'Runs all four stems with 25% overlap and bounded overlap-add. Retains five-second previews only; excludes full-song stem storage and playback.',
        };
        setReport(saved);
        setPreviewUrls(STEM_NAMES.map((_, index) => URL.createObjectURL(previewWav(message.previews[index * 2]!, message.previews[index * 2 + 1]!))));
        setElapsed(saved.pageElapsedMs); setRunning(false); setStage('Benchmark complete. Listen to the previews, then save this report.'); setFraction(1);
        next.terminate(); worker.current = null;
        record('completed', 'Benchmark completed; save the result for timings');
      };
      next.postMessage({ channels, provider } satisfies BenchmarkInput, channels.map((channel) => channel.buffer));
    } catch (caught) {
      if (generation.current !== token) return;
      worker.current?.terminate(); worker.current = null; setRunning(false); setFraction(null);
      setError(caught instanceof Error ? caught.message : String(caught));
      setStage('Benchmark did not complete. This is not a passing result.');
      record('failed', 'Decode or worker startup failed', caught instanceof Error ? caught.message : String(caught));
    }
  };

  const saveReport = (): void => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `mixdeck-stems-${Math.round(report.clipSeconds)}s-${report.provider}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const saveLastDiagnostic = (): void => {
    if (!diagnostic) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...diagnostic, model: STEM_MODEL }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'mixdeck-stems-diagnostic.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return <main className="stems-lab">
    <a className="stems-back" href={import.meta.env.BASE_URL}>← Back to MixDeck</a>
    <h1>Stems feasibility test</h1>
    <p>Run this on your iPhone or iPad. Start with 30 seconds, then test 4 minutes. Keep the app visible while it works.</p>
    <p>Your song stays on this device. The first run downloads the <strong>166 MB</strong> model plus the inference runtime. Best on Wi-Fi.</p>
    <div className="stems-controls">
      <label>Audio file<input type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.aac,.ogg" disabled={running}
        onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReport(null); setPreviewUrls([]); }} /></label>
      <label>Clip length<select value={duration} disabled={running} onChange={(event) => setDuration(Number(event.target.value) as 30 | 240)}>
        <option value={30}>First 30 seconds</option><option value={240}>First 4 minutes</option>
      </select></label>
      <label>Processing<select value={provider} disabled={running} onChange={(event) => setProvider(event.target.value as ProviderPreference)}>
        <option value="auto">Try WebGPU, fall back to WASM</option><option value="wasm">WASM CPU only</option>
      </select></label>
      <button disabled={!file || running} onClick={() => { void run(); }}>Download / reuse model &amp; run</button>
      {running && <button className="stems-cancel" onClick={cancel}>Cancel test</button>}
    </div>
    <p className="stems-status" role="status">{stage}{running && ` · ${seconds(elapsed)} elapsed`}</p>
    {running && <progress aria-label="Benchmark progress" value={fraction ?? undefined} max={1} />}
    {error && <p className="stems-error" role="alert">{error}</p>}
    {!running && diagnostic && diagnostic.status !== 'completed' && <section aria-label="Last run diagnostics">
      <p>{diagnostic.status === 'running'
        ? 'The previous test ended before completion. The browser may have closed or reloaded.'
        : `Last test: ${diagnostic.status}.`} Last recorded stage: {diagnostic.stage}</p>
      {diagnostic.error && diagnostic.error !== error && <p className="stems-detail">{diagnostic.error}</p>}
      <button onClick={saveLastDiagnostic}>Save last run diagnostics</button>
    </section>}
    {report && <section aria-label="Benchmark result">
      <h2>Result</h2>
      <dl className="stems-results">
        <dt>Clip processed</dt><dd>{report.clipSeconds.toFixed(2)} s · {report.chunks} chunks</dd>
        <dt>Processing</dt><dd>{report.provider === 'wasm' ? 'WASM CPU' : report.gpuSubmissionsObserved > 0 ? `WebGPU + CPU (${report.gpuSubmissionsObserved} GPU submissions observed)` : 'WebGPU session; GPU execution unverified'}</dd>
        <dt>Separation</dt><dd>{seconds(report.separationMs)}</dd>
        <dt>Decode / resample</dt><dd>{seconds(report.decodeMs)}</dd>
        <dt>Model read / download</dt><dd>{seconds(report.downloadMs)} · {report.modelFromCache ? 'from cache' : 'downloaded'}</dd>
        <dt>Session preparation</dt><dd>{seconds(report.initializationMs)}</dd>
        <dt>Start to result</dt><dd>{seconds(report.pageElapsedMs)}</dd>
        <dt>Total peak memory</dt><dd>Unavailable in browsers (including Safari)</dd>
        <dt>Worker JS heap sample</dt><dd>{report.peakWorkerJsHeapBytes === null ? 'Unavailable' : `${mib(report.peakWorkerJsHeapBytes)}; excludes WASM / GPU`}</dd>
        <dt>Owned PCM estimate</dt><dd>{mib(report.ownedPcmBytes)}; excludes model / runtime / decode</dd>
        <dt>Model cached</dt><dd>{report.modelCached ? 'Yes; browser may evict it' : 'No; next run will download again'}</dd>
      </dl>
      {report.fallbackReason && <p className="stems-detail">{report.fallbackReason}</p>}
      <p><strong>{report.clipSeconds >= 239.99
        ? report.separationMs <= 120_000 ? 'Speed threshold met on this device. iPhone stability and listening approval are still required.' : 'Over the two-minute separation target on this device.'
        : 'The four-minute gate is still pending. Short clips do not establish a pass.'}</strong></p>
      <p>Only the first five seconds of each separated stem are retained. Full-song storage, playback and controls are outside this test.</p>
      <div className="stems-previews">{previewUrls.map((url, index) => <label key={url}>{STEM_NAMES[index]}<audio controls preload="metadata" src={url} /></label>)}</div>
      <button onClick={saveReport}>Save benchmark report</button>
    </section>}
    <details><summary>Model and test details</summary>
      <p><a href={STEM_MODEL.card} target="_blank" rel="noreferrer">Pinned HTDemucs model and publisher declaration</a>. {STEM_MODEL.license} <a href={STEM_MODEL.weightTerms} target="_blank" rel="noreferrer">Upstream weight terms</a>. Four stems: drums, bass, other, vocals. Half precision applies to stored weights; inference uses float32.</p>
      <p>This is an experimental feasibility page. Passing requires a real four-minute iPhone run without a crash, separation in about two minutes or less, and acceptable listening results. No server fallback is enabled.</p>
      <p className="stems-detail">SHA-256: {STEM_MODEL.sha256}</p>
      <details><summary>Model license notice</summary><pre className="stems-license">{modelNotice}</pre></details>
    </details>
  </main>;
}
