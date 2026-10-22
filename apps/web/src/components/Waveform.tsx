import { useEffect, useRef, type MutableRefObject } from 'react';

/** A labelled vertical line, e.g. a Dancer-mode cue. */
export interface WaveformMarker {
  /** seconds */
  time: number;
  color: string;
  label?: string;
}

interface Props {
  peaks: Float32Array | null;
  duration: number;
  bpm: number | null;
  firstBeat: number;
  loop: { start: number; end: number } | null;
  /** DJ cue point; omit to draw none. */
  cuePoint?: number;
  positionRef: MutableRefObject<number>;
  onSeek: (seconds: number) => void;
  markers?: WaveformMarker[];
}

/** Overview waveform with bar markers, loop region, cue, labelled markers and playhead. Redraws on rAF while mounted. */
export function Waveform({ peaks, duration, bpm, firstBeat, loop, cuePoint, positionRef, onSeek, markers }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== w * dpr || el.height !== h * dpr) {
        el.width = w * dpr;
        el.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const styles = getComputedStyle(el);
      const accent = styles.getPropertyValue('--accent').trim() || '#6cf';

      if (peaks && duration > 0) {
        // loop region
        if (loop) {
          ctx.fillStyle = 'rgba(255, 200, 60, 0.18)';
          const x0 = (loop.start / duration) * w;
          const x1 = (loop.end / duration) * w;
          ctx.fillRect(x0, 0, x1 - x0, h);
        }
        // bars (every 4 beats)
        if (bpm) {
          const bar = (4 * 60) / bpm;
          ctx.strokeStyle = 'rgba(255,255,255,0.12)';
          ctx.beginPath();
          for (let t = firstBeat % bar; t < duration; t += bar) {
            const x = Math.round((t / duration) * w) + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
          ctx.stroke();
        }
        // peaks
        const mid = h / 2;
        const cols = peaks.length;
        ctx.fillStyle = accent;
        for (let x = 0; x < w; x++) {
          const i = Math.floor((x / w) * cols);
          const p = (peaks[i] ?? 0) * (h / 2) * 0.95;
          ctx.fillRect(x, mid - p, 1, Math.max(1, p * 2));
        }
      } else {
        // placeholder while nothing is loaded or analysis is still running (or failed)
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
      }
      // position overlays need only the duration, so cues and the playhead show before (and without) analysis
      if (duration > 0) {
        // markers: coloured line with a small label chip at the top
        if (markers && markers.length) {
          ctx.font = '600 10px system-ui, -apple-system, sans-serif';
          ctx.textBaseline = 'top';
          for (const m of markers) {
            const x = (m.time / duration) * w;
            ctx.fillStyle = m.color;
            ctx.fillRect(x - 1, 0, 2, h);
            if (m.label) {
              const tw = Math.ceil(ctx.measureText(m.label).width) + 6;
              const lx = Math.max(0, Math.min(x + 1, w - tw));
              ctx.fillRect(lx, 0, tw, 14);
              ctx.fillStyle = '#000';
              ctx.fillText(m.label, lx + 3, 2);
            }
          }
        }
        // cue
        if (cuePoint !== undefined) {
          const cx = (cuePoint / duration) * w;
          ctx.fillStyle = '#ff9f40';
          ctx.fillRect(cx - 1, 0, 2, h);
        }
        // playhead
        const px = (positionRef.current / duration) * w;
        ctx.fillStyle = '#fff';
        ctx.fillRect(px - 1, 0, 2, h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [peaks, duration, bpm, firstBeat, loop, cuePoint, positionRef, markers]);

  return (
    <canvas
      ref={canvas}
      className="waveform"
      onClick={(e) => {
        if (!duration) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * duration);
      }}
    />
  );
}
