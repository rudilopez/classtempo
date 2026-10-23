import { formatTime } from '../types';
import { padColor } from './CuePads';
import type { CueSlots } from './cueStore';
import './videoTimeline.css';

interface Props {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  disabled?: boolean;
  cues?: CueSlots;
  practiceRange?: { start: number; end: number };
}

/** A thin seek line inside a full 44 px touch target, with readable elapsed/total times. */
export function VideoTimeline({ position, duration, onSeek, disabled = false, cues = [], practiceRange }: Props) {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const value = Math.max(0, Math.min(end, Number.isFinite(position) ? position : 0));
  const percent = (time: number) => end > 0 ? Math.max(0, Math.min(100, time / end * 100)) : 0;
  const range = practiceRange && end > 0 && Number.isFinite(practiceRange.start) && Number.isFinite(practiceRange.end)
    && practiceRange.end > practiceRange.start ? practiceRange : null;
  return <div className="video-timeline" onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}>
    <span>{formatTime(value)}</span>
    <div className="video-timeline-track">
      <input type="range" aria-label="Video position" aria-valuetext={`${formatTime(value)} of ${formatTime(end)}`}
        min={0} max={end || 1} step="0.01" value={value} disabled={disabled || !end}
        onChange={(event) => onSeek(Number(event.target.value))} />
      <div className="video-timeline-marks" aria-hidden="true">
        {range && <span className="video-timeline-range" style={{ left: `${percent(range.start)}%`, width: `${percent(range.end) - percent(range.start)}%` }} />}
        {end > 0 && cues.map((cue, index) => cue && Number.isFinite(cue.time) && <span key={index} className="video-timeline-cue"
          style={{ left: `${percent(cue.time)}%`, backgroundColor: padColor(index) }} />)}
      </div>
    </div>
    <span>{formatTime(end)}</span>
  </div>;
}
