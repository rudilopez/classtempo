interface Props {
  /** percent, TEMPO_MIN..TEMPO_MAX */
  value: number;
  onChange: (percent: number) => void;
  disabled?: boolean;
}

export const TEMPO_MIN = 50;
export const TEMPO_MAX = 150;
const PRESETS = [50, 75, 90, 100, 110];

/** Rounds to a whole percent inside the StretchDeck's 0.5..1.5 range. */
export function clampTempo(percent: number): number {
  return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, Math.round(percent)));
}

/** Tempo slider with ±1 % nudges at its ends and one row of preset chips. The StretchDeck always preserves pitch, hence "key locked". */
export function TempoControl({ value, onChange, disabled = false }: Props) {
  const set = (p: number) => onChange(clampTempo(p));
  return (
    <div className="tempo">
      <div className="tempo-head">
        <label htmlFor="dancer-tempo">Tempo · key locked</label>
        <span className="tempo-readout">{value}%</span>
      </div>
      <div className="tempo-slider">
        <button className="tempo-nudge" onClick={() => set(value - 1)} disabled={disabled || value <= TEMPO_MIN} title="Slower (←)">
          −1 %
        </button>
        <input
          id="dancer-tempo"
          type="range"
          min={TEMPO_MIN}
          max={TEMPO_MAX}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(e) => set(Number(e.target.value))}
          onDoubleClick={() => set(100)}
          title="Double-click to reset to 100 %"
        />
        <button className="tempo-nudge" onClick={() => set(value + 1)} disabled={disabled || value >= TEMPO_MAX} title="Faster (→)">
          +1 %
        </button>
      </div>
      <div className="tempo-buttons">
        {PRESETS.map((p) => (
          <button key={p} className={value === p ? 'on' : ''} onClick={() => set(p)} disabled={disabled}>
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}
