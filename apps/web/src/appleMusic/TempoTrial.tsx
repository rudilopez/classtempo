import { useEffect, useRef, useState } from 'react';
import type { MusicKitInstance } from './client';
import { AppleMusicPicker } from './AppleMusicPicker';

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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const result = useRef<{ sourceSeconds: number; wallSeconds: number; measuredRate: number } | null>(null);
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; result.current = null; setTiming('');
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [instance, trackId, requestedRate, playing, seeking]);

  // Apple's rendered media element is diagnostic-only. Its absence is unknown;
  // never substitute an unrelated local video element or patch SDK internals.
  const media = () => Array.from(document.querySelectorAll<HTMLMediaElement>('audio#apple-music-player, video#apple-music-player')).map((element) => {
    const legacy = element as HTMLMediaElement & { webkitPreservesPitch?: boolean };
    return {
      kind: element.tagName.toLowerCase(), paused: element.paused, muted: element.muted,
      volume: element.volume, rate: element.playbackRate, readyState: element.readyState,
      preservesPitch: typeof element.preservesPitch === 'boolean' ? element.preservesPitch
        : typeof legacy.webkitPreservesPitch === 'boolean' ? legacy.webkitPreservesPitch : null,
    };
  });
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
      app: 'ClassTempo', test: 'web-tempo-v1', browser: navigator.userAgent,
      requestedRate, reportedRate: instance?.playbackRate ?? null,
      playing: instance?.isPlaying ?? false, media: media(), timing: result.current,
    };
    try {
      void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => setCopyStatus('Details copied.'), () => setCopyStatus('Could not copy details in this browser.'));
    } catch { setCopyStatus('Could not copy details in this browser.'); }
  };

  return <>
    <button type="button" className="apple-tempo-info" title="View Apple Music playback settings" onClick={() => setDetails(true)}>Playback info</button>
    {details && <AppleMusicPicker title="Playback info" onClose={() => setDetails(false)}>
      <p>View your browser's playback settings or copy details to help troubleshoot an issue.</p>
      <p>Requested: <strong>{Math.round(requestedRate * 100)}%</strong> · Apple reports: <strong>{Math.round((instance?.playbackRate ?? 1) * 100)}%</strong></p>
      <p>Pitch preservation: <strong>{media().some((item) => item.preservesPitch === false) ? 'Off on a media element' : media().some((item) => item.preservesPitch === true) ? 'Browser enabled' : 'Not reported yet'}</strong>. This setting alone does not prove sound quality.</p>
      <button type="button" disabled={!playing || seeking || timer.current !== null} onClick={checkTiming}>Check timing for 12 seconds</button>
      {timing && <p role="status">{timing}</p>}
      <button type="button" onClick={copy}>Copy playback details</button>
      {copyStatus && <p role="status">{copyStatus}</p>}
      <p>Details contain browser and playback settings only. No account credentials or audio are copied.</p>
    </AppleMusicPicker>}
  </>;
}
