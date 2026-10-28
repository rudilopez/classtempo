interface Props {
  /** percent, TEMPO_MIN..TEMPO_MAX */
  value: number;
  onChange: (percent: number) => void;
  disabled?: boolean;
  inputId?: string;
  keyLocked?: boolean;
}

export const TEMPO_MIN = 50;
export const TEMPO_MAX = 150;
const PRESETS = [50, 75, 90, 100, 110];

/** Rounds to a whole percent inside the StretchDeck's 0.5..1.5 range. */
export function clampTempo(percent: number): number {
  return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(percent)));
}

/** Shared tempo layout; only playback paths that establish pitch preservation use the key-locked label. */
export function TempoControl({ value, onChange, disabled = false, inputId = 'dancer-tempo', keyLocked = true }: Props) {
  const set = (p: number) => onChange(clampTempo(p));
  return (
    <div className="tempo">
      <div className="tempo-slider">
        <label className="tempo-label" htmlFor={inputId}>Tempo</label>
        <button className="tempo-nudge" onClick={() => set(value - 1)} disabled={disabled || value <= TEMPO_MIN} title={keyLocked ? 'Slower (←)' : 'Slower'} aria-label="Decrease tempo by 1 percent">
          −1 %
        </button>
        <div className="tempo-track">
          <input
            id={inputId}
            type="range"
            min={TEMPO_MIN}
            max={TEMPO_MAX}
            step={1}
            value={value}
            disabled={disabled}
            onChange={(e) => set(Number(e.target.value))}
            onDoubleClick={() => set(100)}
            aria-label={keyLocked ? 'Tempo, key locked' : 'Apple Music tempo'}
            aria-valuetext={`${value} percent${keyLocked ? ', key locked' : ''}`}
            title="Double-click to reset to 100 %"
          />
          <span className="tempo-readout" aria-hidden="true">{value}%</span>
        </div>
        <button className="tempo-nudge" onClick={() => set(value + 1)} disabled={disabled || value >= TEMPO_MAX} title={keyLocked ? 'Faster (→)' : 'Faster'} aria-label="Increase tempo by 1 percent">
          +1 %
        </button>
      </div>
      <div className="tempo-buttons">
        {PRESETS.map((p) => (
          <button key={p} className={value === p ? 'on' : ''} aria-pressed={value === p} onClick={() => set(p)} disabled={disabled}>
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}
