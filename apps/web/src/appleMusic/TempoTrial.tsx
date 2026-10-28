import { useEffect, useRef, useState } from 'react';
import type { MusicKitInstance } from './client';
import { AppleMusicPicker } from './AppleMusicPicker';
import { localAudioContextDetails } from '../platform/localAudioDiagnostics';
import {
  APPLE_MEDIA_SELECTOR, createPlaybackDiagnosticsMonitor,
  type PlaybackDiagnostics, type PlaybackDiagnosticsMonitor,
} from './playbackDiagnostics';

interface Props {
  instance: MusicKitInstance | null;
  trackId: string | null;
  requestedRate: number;
  playing: boolean;
  seeking: boolean;
}

/** Read-only playback diagnostics. No media samples, source URLs or credentials are read. */
export function TempoTrial({ instance, trackId, requestedRate, playing, seeking }: Props): React.ReactElement {
  const [details, setDetails] = useState(false);
  const [timing, setTiming] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [diagnostics, setDiagnostics] = useState<PlaybackDiagnostics>({ media: [], events: [] });
  const monitor = useRef<PlaybackDiagnosticsMonitor | null>(null);
  const detailsOpen = useRef(details);
  detailsOpen.current = details;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = useRef<{ sourceSeconds: number; wallSeconds: number; measuredRate: number } | null>(null);
  useEffect(() => {
    setDiagnostics({ media: [], events: [] });
    setCopyStatus('');
    if (!instance || !trackId) return;
    // Apple's rendered element is diagnostic-only. Never substitute a local video
    // or mutate the provider's element, even when it is replaced during playback.
    const observer = createPlaybackDiagnosticsMonitor(() => Array.from(
      document.querySelectorAll<HTMLMediaElement>(APPLE_MEDIA_SELECTOR),
    ));
    monitor.current = observer;
    const sync = (): void => { observer.sync(); };
    sync();
    const mutations = new MutationObserver(sync);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['id'] });
    const refresh = setInterval(() => {
      sync();
      if (detailsOpen.current) setDiagnostics(observer.snapshot());
    }, 500);
    return () => {
      clearInterval(refresh);
      mutations.disconnect();
      observer.dispose();
      if (monitor.current === observer) monitor.current = null;
    };
  }, [instance, trackId]);
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; result.current = null; setTiming('');
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [instance, trackId, requestedRate, playing, seeking]);

  const snapshot = (): PlaybackDiagnostics => {
    monitor.current?.sync();
    return monitor.current?.snapshot() ?? { media: [], events: [] };
  };
  const targetBitrate = typeof instance?.bitrate === 'number' && Number.isFinite(instance.bitrate) && instance.bitrate > 0 ? instance.bitrate : null;
  const currentMedia = diagnostics.media.find((item) => !item.paused) ?? diagnostics.media[0];
  const bufferedAhead = currentMedia?.bufferedAheadSeconds ?? null;
  const localAudioContext = localAudioContextDetails();
  const checkTiming = (): void => {
    if (!instance || !playing || seeking || timer.current !== null) return;
    const sourceStart = instance.currentPlaybackTime;
    const wallStart = performance.now();
    if (!Number.isFinite(sourceStart)) return;
    setTiming('Checking 12 seconds of playback…');
    timer.current = setTimeout(() => {
      timer.current = null;
      const sourceSeconds = instance.currentPlaybackTime - sourceStart;
      const wallSeconds = (performance.now() - wallStart) / 1000;
      const measuredRate = sourceSeconds / wallSeconds;
      if (!instance.isPlaying || !Number.isFinite(measuredRate) || sourceSeconds <= 0 || Math.abs(measuredRate - requestedRate) > 0.15) {
        result.current = null;
        setTiming('Timing was interrupted or did not match. Try again away from the end of the song.');
        return;
      }
      result.current = { sourceSeconds, wallSeconds, measuredRate };
      setTiming(`About ${Math.round(measuredRate * 100)}% measured speed. Listening still determines sound quality.`);
    }, 12_000);
  };
  const copy = (): void => {
    const report = {
      app: 'ClassTempo', test: 'web-tempo-v2', browser: navigator.userAgent,
      requestedRate, reportedRate: instance?.playbackRate ?? null,
      targetBitrateKbps: targetBitrate,
      localAudioContext: localAudioContextDetails(),
      playing: instance?.isPlaying ?? false, ...snapshot(), timing: result.current,
    };
    try {
      void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => setCopyStatus('Details copied.'), () => setCopyStatus('Could not copy details in this browser.'));
    } catch { setCopyStatus('Could not copy details in this browser.'); }
  };

  return <>
    <button type="button" className="apple-tempo-info" title="View Apple Music playback settings" onClick={() => { setDiagnostics(snapshot()); setDetails(true); }}>Playback info</button>
    {details && <AppleMusicPicker title="Playback info" onClose={() => setDetails(false)}>
      <p>View your browser's playback settings or copy details to help troubleshoot an issue.</p>
      <p>Requested: <strong>{Math.round(requestedRate * 100)}%</strong> · Apple reports: <strong>{Math.round((instance?.playbackRate ?? 1) * 100)}%</strong></p>
      <p>Pitch preservation: <strong>{diagnostics.media.some((item) => item.preservesPitch === false) ? 'Off on a media element' : diagnostics.media.some((item) => item.preservesPitch === true) ? 'Browser enabled' : 'Not reported yet'}</strong>. This setting alone does not prove sound quality.</p>
      <p>Buffered ahead: <strong>{bufferedAhead === null ? 'Not reported yet' : `${Math.floor(bufferedAhead)} s of song audio`}</strong>. Updates while this panel is open.</p>
      <p>Stream quality target: <strong>{targetBitrate === null ? 'Not reported' : `${targetBitrate} kbps`}</strong>. Apple chooses the actual stream quality.</p>
      <p>Local audio engine: <strong>{localAudioContext.created ? localAudioContext.state : 'Not started'}</strong>.</p>
      <p>To check whether buffering helps, pause and watch the buffer. After it grows, replay the same passage at 75%. The browser may stop buffering before the whole song is loaded.</p>
      <button type="button" disabled={!playing || seeking || timer.current !== null} onClick={checkTiming}>Check timing for 12 seconds</button>
      {timing && <p role="status">{timing}</p>}
      <button type="button" onClick={copy}>Copy playback details</button>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <p>Details contain browser and playback settings only. No account credentials or audio are copied.</p>
    </AppleMusicPicker>}
  </>;
}
